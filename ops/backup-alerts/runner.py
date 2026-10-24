"""Linux-only operational entrypoint. No SDK, dotenv loading, URL argv or secret logs."""
import datetime as dt
import base64
import configparser
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from urllib.parse import parse_qs, unquote, urlsplit
import uuid

STATE = Path("/var/lib/infraforge-ops")
BOOTSTRAP = Path(__file__).resolve().parents[1] / "bootstrap"
MAX_OBJECT_BYTES = 5_000_000_000  # Single PUT; no multipart or abort operations.
CREDENTIALS = Path("/etc/infraforge/ops/r2.credentials")
LOCK_TOKEN = Path("/etc/infraforge/ops/r2-lock-read.token")
PREFIXES = ("backups/daily/", "backups/weekly/")
RETENTION_SECONDS = 28 * 86400
MAX_LIST_PAGES = 4  # Per prefix, 1000 objects per page.
MAX_PRUNE_OBJECTS = 128


def command(args, *, env=None, seconds=60):
    # Child output can include connection diagnostics; never forward it to journal.
    return subprocess.run(args, env=env, timeout=seconds, check=True,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout


def clean_env():
    # Separate source DB credentials from Docker, AWS CLI and restore processes.
    return {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "HOME": "/nonexistent", "AWS_MAX_ATTEMPTS": "2", "AWS_PAGER": "",
            "AWS_RETRY_MODE": "standard", "AWS_EC2_METADATA_DISABLED": "true",
            "AWS_CONFIG_FILE": "/dev/null", "AWS_SHARED_CREDENTIALS_FILE": "/dev/null",
            "AWS_REQUEST_CHECKSUM_CALCULATION": "when_required",
            "AWS_RESPONSE_CHECKSUM_VALIDATION": "when_required"}


def source_env(url):
    """Accept one direct PostgreSQL endpoint; discard ambient libpq routing."""
    try:
        parsed = urlsplit(url)
        host = parsed.hostname or ""
        params = parse_qs(parsed.query, strict_parsing=True, keep_blank_values=True)
        local = host == "postgres" and parsed.port in (None, 5432)
        if (parsed.scheme not in ("postgres", "postgresql") or parsed.fragment or
                not host or re.search(r"[\s/\\%]", host) or
                "-pooler." in host or
                not parsed.username or not parsed.password or not parsed.path[1:] or
                "/" in parsed.path[1:] or parsed.port == 0 or
                set(params) - {"sslmode", "channel_binding"}):
            raise ValueError
        modes = (["disable"], ["verify-full"]) if local else (["verify-full"],)
        if params.get("sslmode", ["disable"] if local else []) not in modes:
            raise ValueError
        if params.get("channel_binding", ["require"]) != ["require"]:
            raise ValueError
        result = clean_env()
        result.update(PGHOST=host, PGPORT=str(parsed.port or 5432), PGUSER=unquote(parsed.username),
                      PGPASSWORD=unquote(parsed.password), PGDATABASE=unquote(parsed.path[1:]),
                      PGSSLMODE=params.get("sslmode", ["disable"])[0],
                      PGCHANNELBINDING=params.get("channel_binding", ["prefer"])[0],
                      PGPASSFILE="/dev/null", PGCONNECT_TIMEOUT="5")
        if result["PGSSLMODE"] == "verify-full":
            result["PGSSLROOTCERT"] = "system"
        return result
    except (ValueError, TypeError):
        raise ValueError("Invalid direct PostgreSQL backup connection") from None


def source_url():
    # systemd copies the owner-managed release.env into a private credential.
    # Parse one literal URL only; never execute/source the file or interpolate it.
    injected = os.environ.pop("BACKUP_DATABASE_URL", None)
    if injected is not None:
        return injected
    lines = (Path(os.environ["CREDENTIALS_DIRECTORY"]) / "release-env").read_text().splitlines()
    values = [line.split("=", 1)[1].strip() for line in lines if line.startswith("MIGRATION_DATABASE_URL=")]
    if len(values) != 1:
        raise ValueError("Exactly one literal MIGRATION_DATABASE_URL is required")
    value = values[0]
    if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    if not value or re.search(r"[\s$]", value):
        raise ValueError("Backup URL must be literal; percent-encode special characters")
    return value


class DatabaseStartingError(ValueError):
    pass


def local_source(env):
    """Resolve only our private, unpublished Compose service on the Linux host."""
    if env["PGHOST"] != "postgres" or env["PGPORT"] != "5432":
        return
    ids = command(["docker", "ps", "-q", "--filter", "label=com.docker.compose.project=infraforge",
                   "--filter", "label=com.docker.compose.service=postgres"], env=clean_env(), seconds=10).decode().split()
    if not ids:
        raise DatabaseStartingError("Private PostgreSQL container has not started")
    if len(ids) != 1:
        raise ValueError("Exactly one running private PostgreSQL container is required")
    records = json.loads(command(["docker", "inspect", ids[0]], env=clean_env(), seconds=10))
    db = records[0]
    labels = db["Config"]["Labels"]
    networks = db["NetworkSettings"]["Networks"]
    if (len(records) != 1 or labels.get("com.docker.compose.project") != "infraforge" or
            labels.get("com.docker.compose.service") != "postgres" or not db["State"]["Running"] or
            db["HostConfig"].get("PortBindings") or len(networks) != 1):
        raise ValueError("PostgreSQL container ownership/network mismatch")
    attached = next(iter(networks.values()))
    network = json.loads(command(["docker", "network", "inspect", attached["NetworkID"]], env=clean_env(), seconds=10))[0]
    if (not network.get("Internal") or network.get("Driver") != "bridge" or
            network.get("Labels", {}).get("com.docker.compose.project") != "infraforge"):
        raise ValueError("PostgreSQL backup requires the owned internal bridge")
    address = ipaddress.ip_address(attached["IPAddress"])
    if not address.is_private or address.is_loopback or address.is_unspecified:
        raise ValueError("Invalid private PostgreSQL address")
    env.update(PGHOST=str(address), PGHOSTADDR=str(address))


def wait_local_source(env, budget=180):
    """Allow reboot recovery within the job budget; never retry unsafe ownership."""
    if env["PGHOST"] != "postgres" or env["PGPORT"] != "5432":
        return
    deadline = time.monotonic() + budget
    while time.monotonic() < deadline:
        candidate = env.copy()
        try:
            # Resolve again on every attempt in case recovery replaced the container.
            local_source(candidate)
            result = command(["psql", "-X", "--no-password", "-At", "-v", "ON_ERROR_STOP=1",
                              "-c", "SELECT 1"], env=candidate, seconds=10)
            if result.strip() != b"1":
                raise ValueError("Unexpected authenticated readiness result")
            env.update(candidate)
            return
        except (DatabaseStartingError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            remaining = deadline - time.monotonic()
            if remaining > 0:
                time.sleep(min(5, remaining))
    raise TimeoutError("Private PostgreSQL startup readiness deadline exceeded")


def read_json(path):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, ValueError):
        return {}


def write_json(path, value):
    # Backup failure hooks and the minute monitor can write concurrently.
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False, encoding="utf-8") as target:
        temporary = Path(target.name)
        try:
            os.chmod(temporary, 0o600)
            target.write(json.dumps(value) + "\n")
            target.flush()
            os.fsync(target.fileno())
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def validate_config(config):
    for key in ("prune_enabled", "restore_drill_required"):
        if key in config and type(config[key]) is not bool:
            raise ValueError("Operations switches must be booleans")
    days = config.get("restore_drill_max_age_days", 35)
    if type(days) is not int or not 1 <= days <= 366:
        raise ValueError("Restore freshness must be 1 to 366 days")
    for key, pattern in {
        "region": r"auto|[a-z]{2}(?:-[a-z]+)+-\d",
        "bucket": r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]",
        "worker_container": r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}",
        "drill_image": r"postgres:18@sha256:[0-9a-f]{64}",
    }.items():
        if not re.fullmatch(pattern, config.get(key, "")):
            raise ValueError("Invalid operations configuration")
    for key in ("endpoint_url", "site_url", "api_url"):
        url = urlsplit(config.get(key, ""))
        if (url.scheme != "https" or not url.hostname or url.username or
                url.password or url.fragment or url.query or
                (key == "endpoint_url" and url.path not in ("", "/"))):
            raise ValueError("Expected credential-free public HTTPS URLs")


def private_text(path):
    # Validate the opened descriptor before reading any credential bytes.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError("Credentials require root ownership and mode 0600")
        return source.read()


def private_credentials():
    parser = configparser.ConfigParser(interpolation=None)
    parser.read_string(private_text(CREDENTIALS))
    if parser.sections() != ["default"] or set(parser["default"]) != {"aws_access_key_id", "aws_secret_access_key"}:
        raise ValueError("Expected one explicit storage credential pair")
    values = [parser["default"][key] for key in ("aws_access_key_id", "aws_secret_access_key")]
    if any(not value or re.search(r"\s", value) for value in values):
        raise ValueError("Invalid storage credentials")
    return values


def s3(config, args, seconds=180):
    access, secret = private_credentials()
    env = clean_env()
    # Credentials go only to the client process; never argv, journal or diagnostics.
    env.update(AWS_ACCESS_KEY_ID=access, AWS_SECRET_ACCESS_KEY=secret)
    return command(["aws", "--endpoint-url", config["endpoint_url"],
                    "--region", config["region"], "--no-cli-pager", "--output", "json",
                    "--cli-connect-timeout", "5", "--cli-read-timeout", "60", *args],
                   env=env, seconds=seconds)


def backup_key(key):
    if not isinstance(key, str) or not re.fullmatch(
            r"backups/(?:daily/\d{4}-\d{2}-\d{2}|weekly/\d{4}-W\d{2})(?:-[0-9a-f]{32})?\.tar", key):
        raise ValueError("Object is outside the supported backup keys")
    return key


def file_hash(path, algorithm="sha256"):
    with path.open("rb") as source:
        return hashlib.file_digest(source, algorithm).digest()


def storage_identity(config):
    return hashlib.sha256(json.dumps([config["endpoint_url"].rstrip("/"), config["bucket"], config["region"]]).encode()).hexdigest()


def download(config, key, target):
    backup_key(key)
    head = json.loads(s3(config, ["s3api", "head-object", "--bucket", config["bucket"], "--key", key]))
    size = head.get("ContentLength")
    if type(size) is not int or not 0 < size <= MAX_OBJECT_BYTES or not head.get("ETag"):
        raise ValueError("Remote archive exceeds bounded retrieval policy")
    s3(config, ["s3api", "get-object", "--bucket", config["bucket"], "--key", key,
                "--if-match", head["ETag"], str(target)], seconds=700)
    if target.stat().st_size != size:
        raise ValueError("Incomplete retrieved archive")


def upload(config, bundle, key):
    backup_key(key)
    if not 0 < bundle.stat().st_size <= MAX_OBJECT_BYTES:
        raise ValueError("Archive exceeds bounded single-PUT policy")
    # R2 does not implement AWS SSE-S3 or full-object SHA256 request checksums.
    # Content-MD5 checks transport; SHA256 of a remote readback verifies the bytes.
    digest = file_hash(bundle)
    s3(config, ["s3api", "put-object", "--bucket", config["bucket"], "--key", key,
                "--body", str(bundle), "--if-none-match", "*",
                "--content-md5", base64.b64encode(file_hash(bundle, "md5")).decode()], seconds=700)
    with tempfile.TemporaryDirectory(dir=STATE) as work:
        retrieved = Path(work) / "readback.tar"
        download(config, key, retrieved)
        if file_hash(retrieved) != digest:
            raise ValueError("Remote backup checksum mismatch")


def object_time(value):
    instant = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if instant.tzinfo is None:
        raise ValueError("Object age must include timezone")
    return instant.timestamp()


def verify_retention_locks(config):
    # Only R2 has a verified retention boundary here. Generic S3-compatible
    # uploads/retrieval remain supported; destructive pruning fails closed.
    endpoint = urlsplit(config["endpoint_url"])
    match = re.fullmatch(r"([0-9a-f]{32})(?:\.(eu|us|fedramp))?\.r2\.cloudflarestorage\.com", endpoint.hostname or "")
    if (not match or endpoint.scheme != "https" or endpoint.port not in (None, 443) or
            endpoint.username or endpoint.password or endpoint.query or endpoint.fragment or
            endpoint.path not in ("", "/") or config["region"] != "auto" or
            not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", config["bucket"])):
        raise ValueError("Destructive pruning requires the configured R2 origin")
    token = private_text(LOCK_TOKEN).strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,256}", token):
        raise ValueError("Invalid private lock-read API token")
    headers = {"Authorization": "Bearer " + token}
    if match[2]:
        headers["cf-r2-jurisdiction"] = match[2]
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{match[1]}/r2/buckets/{config['bucket']}/lock",
        headers=headers)
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=5) as response:
        if response.status != 200:
            raise ValueError("Cannot verify storage retention locks")
        payload = response.read(262145)
    if len(payload) > 262144:
        raise ValueError("Lock configuration exceeds verification budget")
    body = json.loads(payload)
    if body.get("success") is not True:
        raise ValueError("Cannot verify storage retention locks")
    rules = body.get("result", {}).get("rules", [])
    for prefix in PREFIXES:
        protected = False
        for rule in rules:
            condition = rule.get("condition", {})
            duration = condition.get("maxAgeSeconds")
            scope = rule.get("prefix", "")
            if (rule.get("enabled") is True and condition.get("type") == "Age" and
                    type(duration) in (int, float) and math.isfinite(duration) and duration >= RETENTION_SECONDS and
                    isinstance(scope, str) and prefix.startswith(scope)):
                protected = True
        if not protected:
            raise ValueError("Enabled age locks of at least 28 days must cover both backup prefixes")
    return rules


def retention_deadline(key, modified, rules):
    """The strictest applicable rule wins, including narrower prefix locks."""
    created = object_time(modified)
    deadline = created + RETENTION_SECONDS
    for rule in rules:
        if rule.get("enabled") is not True:
            continue
        prefix = rule.get("prefix", "")
        if not isinstance(prefix, str):
            raise ValueError("Invalid lock prefix")
        if not key.startswith(prefix):
            continue
        condition = rule.get("condition", {})
        kind = condition.get("type")
        if kind == "Age":
            duration = condition.get("maxAgeSeconds")
            if type(duration) not in (int, float) or not math.isfinite(duration) or duration < 0:
                raise ValueError("Invalid lock age")
            deadline = max(deadline, created + duration)
        elif kind == "Date":
            deadline = max(deadline, object_time(condition["date"]))
        elif kind == "Indefinite":
            deadline = math.inf
        else:
            raise ValueError("Unknown lock condition")
    return deadline


def prune(config, now=None, dry_run=False):
    if not dry_run and config.get("prune_enabled") is not True:
        raise ValueError("Destructive pruning is disabled until storage age locks are verified")
    instant = time.time() if now is None else now
    cutoff = instant - RETENTION_SECONDS
    # Never cache verification. Storage enforces the minimum at DELETE; this
    # policy also avoids attempting deletes that stronger rules still protect.
    # A disabled dry run is only a 28-day inventory, not a verified delete plan.
    rules = verify_retention_locks(config) if not dry_run or config.get("prune_enabled") is True else None
    candidates = {}
    # Plan the entire bounded operation before deleting anything.
    for prefix in PREFIXES:
        token = None
        seen = set()
        for _ in range(MAX_LIST_PAGES):
            args = ["s3api", "list-objects-v2", "--bucket", config["bucket"],
                    "--prefix", prefix, "--max-keys", "1000", "--no-paginate"]
            if token:
                args += ["--continuation-token", token]
            page = json.loads(s3(config, args))
            for item in page.get("Contents", []):
                key = backup_key(item["Key"])
                if not key.startswith(prefix):
                    raise ValueError("Listing escaped requested backup prefix")
                if object_time(item["LastModified"]) < cutoff and (
                        rules is None or instant > retention_deadline(key, item["LastModified"], rules)):
                    candidates[key] = item["LastModified"]
                    if len(candidates) > MAX_PRUNE_OBJECTS:
                        raise ValueError("Prune exceeds deletion budget; operator review required")
            if page.get("IsTruncated") is False:
                break
            token = page.get("NextContinuationToken")
            if not token or token in seen:
                raise ValueError("Invalid bounded listing continuation")
            seen.add(token)
        else:
            raise ValueError("Prune exceeds listing budget; operator review required")
    for key, modified in candidates.items():
        if not dry_run:
            head = json.loads(s3(config, ["s3api", "head-object", "--bucket", config["bucket"], "--key", key]))
            if head.get("LastModified") != modified or object_time(head["LastModified"]) >= cutoff:
                raise ValueError("Prune candidate changed; refusing deletion")
            s3(config, ["s3api", "delete-object", "--bucket", config["bucket"], "--key", key])
    return sorted(candidates)


def prune_dry_run(config):
    for key in prune(config, dry_run=True):
        print(key)


def verify_archive(archive):
    dump = archive / "archive.dump"
    receipt = archive / "SHA256SUMS"
    if archive.is_symlink() or dump.is_symlink() or receipt.is_symlink() or not dump.is_file():
        raise ValueError("Unsafe archive")
    with dump.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if receipt.read_text(encoding="ascii").strip() != f"{digest}  archive.dump":
        raise ValueError("Archive checksum mismatch")


def backup(config, now=None):
    started = time.time() if now is None else now
    instant = dt.datetime.fromtimestamp(started, dt.timezone.utc)
    url = source_url()
    db_env = source_env(url)
    del url
    wait_local_source(db_env)
    root = STATE / "backups"
    root.mkdir(mode=0o700, exist_ok=True)
    previous = read_json(STATE / "backup.json")
    # Clean interrupted work and superseded local copies only under this private root.
    for entry in root.glob("backup.*"):
        if entry.name != previous.get("archive") and entry.is_dir() and not entry.is_symlink():
            shutil.rmtree(entry)
    receipt = command(["bash", str(BOOTSTRAP / "postgres-backup.sh"), str(root)],
                      env=db_env, seconds=700).decode().strip()
    db_env.clear()
    if not receipt.startswith("BACKUP PASS "):
        raise ValueError("Backup receipt absent")
    archive = Path(receipt.removeprefix("BACKUP PASS "))
    if archive.parent != root or archive.is_symlink():
        raise ValueError("Backup escaped private root")
    verify_archive(archive)
    bundle = archive / "backup.tar"
    try:
        with tarfile.open(bundle, "w") as tar:
            for name in ("archive.dump", "SHA256SUMS"):
                tar.add(archive / name, arcname=name, recursive=False)
        suffix = uuid.uuid4().hex
        daily = f"backups/daily/{instant:%Y-%m-%d}-{suffix}.tar"
        week = instant.strftime("%G-W%V")
        upload(config, bundle, daily)
        weekly = previous.get("weekly_key")
        if previous.get("storage") != storage_identity(config) or previous.get("week") != week:
            weekly = f"backups/weekly/{week}-{suffix}.tar"
            upload(config, bundle, weekly)
        prune(config, started)
        # Receipt advances only after every required PUT succeeds; age starts at dump start.
        write_json(STATE / "backup.json", {"snapshot_at": started, "archive": archive.name,
                                          "daily_key": daily, "week": week, "weekly_key": weekly,
                                          "storage": storage_identity(config)})
    finally:
        bundle.unlink(missing_ok=True)
    old_name = previous.get("archive", "")
    if re.fullmatch(r"backup\.[A-Za-z0-9]+", old_name) and old_name != archive.name:
        old = root / old_name
        if old.is_dir() and not old.is_symlink():
            shutil.rmtree(old)


def age(receipt, key, now):
    value = receipt.get(key)
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= now:
        return None
    return now - value


def drill(config):
    # Mark in progress as unhealthy so timeouts, SIGKILL and reboots remain visible.
    write_json(STATE / "drill.json", {"ok": False})
    cleanup_drill(config)  # Recover a recorded owned container left by a host reboot.
    receipt = read_json(STATE / "backup.json")
    elapsed = age(receipt, "snapshot_at", time.time())
    if elapsed is None or elapsed > 93600 or receipt.get("storage") != storage_identity(config):
        raise ValueError("Fresh uploaded archive required for drill")
    # Prove retrieval from off-host storage rather than trust the local dump.
    with tempfile.TemporaryDirectory(dir=STATE) as work:
        archive = Path(work)
        retrieve(config, receipt.get("daily_key", ""), archive)
        restore_drill(config, archive)
    write_json(STATE / "drill.json", {"ok": True, "passed_at": time.time()})


def retrieve(config, key, archive):
    bundle = archive / "backup.tar"
    download(config, key, bundle)
    try:
        with tarfile.open(bundle, "r:") as tar:
            members = tar.getmembers()
            if len(members) != 2 or {item.name for item in members} != {"archive.dump", "SHA256SUMS"}:
                raise ValueError("Unexpected remote archive members")
            for item in members:
                if not item.isfile() or item.size <= 0 or item.size > MAX_OBJECT_BYTES:
                    raise ValueError("Unsafe remote archive member")
                # Copy exact allowed regular members; never use tar path extraction.
                with tar.extractfile(item) as source, (archive / item.name).open("xb") as target:
                    shutil.copyfileobj(source, target)
        verify_archive(archive)
    finally:
        bundle.unlink(missing_ok=True)


def restore_drill(config, archive):
    # First exercise the unchanged owned-container synthetic proof and its refusals.
    command(["bash", str(BOOTSTRAP / "prove-backup.sh")], env=clean_env(), seconds=900)
    name = "infraforge-restore-drill-" + uuid.uuid4().hex
    write_json(STATE / "drill-container.json", {"name": name})
    try:
        command(["docker", "run", "-d", "--pull=never", "--name", name, "--network", "none",
                 "--cpus=0.25", "--memory=384m", "--pids-limit=128",
                 "--security-opt=no-new-privileges:true", "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
                 config["drill_image"]], env=clean_env())
        for _ in range(30):
            try:
                command(["docker", "exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], env=clean_env(), seconds=5)
                break
            except (subprocess.SubprocessError, OSError):
                time.sleep(1)
        else:
            raise RuntimeError("Disposable database did not become ready")
        command(["docker", "exec", name, "mkdir", "-m", "700", "/restore"], env=clean_env())
        for source, dest in [(archive / "archive.dump", "/restore/archive.dump"),
                             (archive / "SHA256SUMS", "/restore/SHA256SUMS"),
                             (BOOTSTRAP / "postgres-restore-verify.sh", "/restore/verify.sh")]:
            command(["docker", "cp", str(source), f"{name}:{dest}"], env=clean_env())
        command(["docker", "exec", name, "env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin",
                 "RESTORE_DISPOSABLE=local-only", "bash", "/restore/verify.sh", "/restore", "5432", "postgres"],
                env=clean_env(), seconds=1300)
    finally:
        # Failure to remove the owned container also fails the drill; no false pass.
        command(["docker", "rm", "-fv", name], env=clean_env())
        (STATE / "drill-container.json").unlink(missing_ok=True)


def cleanup_drill(_config):
    """systemd ExecStopPost also runs after timeout/SIGKILL; remove only our recorded name."""
    marker = STATE / "drill-container.json"
    name = read_json(marker).get("name", "")
    if not name:
        return
    if not re.fullmatch(r"infraforge-restore-drill-[0-9a-f]{32}", name):
        raise ValueError("Unsafe cleanup marker")
    command(["docker", "rm", "-fv", name], env=clean_env(), seconds=30)
    marker.unlink()


def ready(url, api=False):
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            if response.status != 200 or urlsplit(response.url).scheme != "https":
                return 0
            if api:
                body = json.loads(response.read(65536))
                if not isinstance(body, dict) or body.get("success") is not True:
                    return 0
        return 1
    except (OSError, ValueError):
        return 0


def collect(config, now=None, meminfo=Path("/proc/meminfo")):
    now = time.time() if now is None else now
    values = {"SiteReady": (ready(config["site_url"]), "Count"),
              "ApiReady": (ready(config["api_url"], api=True), "Count")}
    try:
        command(["docker", "exec", config["worker_container"], "bun", "--no-env-file",
                 "health/probe.ts", "3002"], env=clean_env(), seconds=8)
        values["WorkerReady"] = (1, "Count")
    except (subprocess.SubprocessError, OSError):
        values["WorkerReady"] = (0, "Count")
    try:
        disks = [shutil.disk_usage(path) for path in (Path("/"), STATE, Path("/var/lib/docker"))]
        values["DiskUsedPercent"] = (max(100 * disk.used / disk.total for disk in disks), "Percent")
        memory = dict(re.findall(r"^(MemTotal|MemAvailable):\s+(\d+) kB$", meminfo.read_text(), re.M))
        total, available = int(memory["MemTotal"]), int(memory["MemAvailable"])
        if not 0 <= available <= total or total == 0:
            raise ValueError("Invalid memory observation")
        values["MemoryUsedPercent"] = (100 * (total - available) / total, "Percent")
    except (OSError, KeyError, ValueError, ZeroDivisionError):
        pass  # Omit unknown host observations rather than invent measurements.
    elapsed = age(read_json(STATE / "backup.json"), "snapshot_at", now)
    if elapsed is not None:
        values["BackupAgeSeconds"] = (elapsed, "Seconds")
    receipt = read_json(STATE / "drill.json")
    elapsed = age(receipt, "passed_at", now)
    values["RestoreDrillHealthy"] = (int(receipt.get("ok") is True and elapsed is not None and elapsed <= 35 * 86400), "Count")
    return [{"MetricName": key, "Value": value, "Unit": unit,
             "Dimensions": []}
            for key, (value, unit) in values.items()]


def metrics(config):
    # Local observations only; the current installation never calls CloudWatch.
    monitor(config)
    write_json(STATE / "metrics.json", {"observed_at": time.time(), "values": collect(config)})


def backup_healthy(config, now=None):
    now = time.time() if now is None else now
    receipt = read_json(STATE / "backup.json")
    elapsed = age(receipt, "snapshot_at", now)
    attempt = read_json(STATE / "backup-attempt.json")
    running_age = age(attempt, "started_at", now)
    running = (attempt.get("running") is True and attempt.get("previous_ok") is True and
               running_age is not None and running_age <= 46 * 60)
    return (receipt.get("storage") == storage_identity(config) and
            elapsed is not None and elapsed <= 26 * 3600 and
            (attempt.get("ok") is True or running))


def drill_healthy(config, now=None):
    now = time.time() if now is None else now
    path = STATE / "drill.json"
    required = config.get("restore_drill_required", False)
    if not path.exists():
        return not required
    receipt = read_json(path)
    elapsed = age(receipt, "passed_at", now)
    # Once attempted, failure/corruption/interruption stays latched even when
    # the monthly timer is intentionally disabled. Only a passed drill clears it.
    if receipt.get("ok") is not True or elapsed is None:
        return False
    return not required or elapsed <= config.get("restore_drill_max_age_days", 35) * 86400


def health_reasons(config, now=None):
    return (["backup-failed-or-missed"] if not backup_healthy(config, now) else []) + (
        ["restore-failed-or-overdue"] if not drill_healthy(config, now) else [])


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Credential-bearing redirects are forbidden")


def send_alert(config):
    # Reuse the application's Resend settings, copied privately by systemd.
    # No shell/dotenv interpolation; only these three literal keys are read.
    path = Path(os.environ["CREDENTIALS_DIRECTORY"]) / "release-env"
    wanted = {"TRANSACTIONAL_EMAIL_PROVIDER", "TRANSACTIONAL_EMAIL_FROM", "RESEND_API_KEY"}
    values = {}
    for line in path.read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and key in wanted:
            if key in values:
                raise ValueError("Duplicate mail setting")
            value = value.strip()
            if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key] = value
    if values.get("TRANSACTIONAL_EMAIL_PROVIDER") != "resend" or not config.get("alert_email"):
        return "unconfigured"
    mailbox = r"[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+"
    if (not re.fullmatch(mailbox, values.get("TRANSACTIONAL_EMAIL_FROM", "")) or
            not re.fullmatch(mailbox, config["alert_email"]) or
            not values.get("RESEND_API_KEY") or re.search(r"[\s$]", values["RESEND_API_KEY"])):
        raise ValueError("Invalid literal Resend configuration")
    reasons = read_json(STATE / "ops-status.json").get("reasons", ["backup-failed-or-missed"])
    messages = {"backup-failed-or-missed": "A backup failed or no verified backup is less than 26 hours old.",
                "restore-failed-or-overdue": "A restore drill failed, was interrupted, or is overdue."}
    payload = {"from": values["TRANSACTIONAL_EMAIL_FROM"], "to": [config["alert_email"]],
               "subject": "InfraForge recovery needs attention",
               "text": " ".join(messages[reason] for reason in reasons) + " Check ops status and service units privately."}
    request = urllib.request.Request("https://api.resend.com/emails", method="POST",
                                     data=json.dumps(payload).encode(),
                                     headers={"Authorization": "Bearer " + values["RESEND_API_KEY"],
                                              "Content-Type": "application/json"})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=5) as response:
        if not 200 <= response.status < 300:
            raise ValueError("Mail delivery failed")
    return "sent"


def monitor(config):
    now = time.time()
    reasons = health_reasons(config, now)
    healthy = not reasons
    previous = read_json(STATE / "ops-status.json")
    state = {"ok": healthy, "checked_at": now, "reasons": reasons,
             "alert_delivery": "not-needed" if healthy else previous.get("alert_delivery", "pending")}
    # Persist failure BEFORE attempting delivery; provider failure never hides it.
    if not healthy:
        attempt_age = age(previous, "alert_attempt_at", now)
        retry_after = 3600 if previous.get("alert_delivery") == "sent" else 900
        if (previous.get("ok") is not True and previous.get("reasons") == reasons and
                attempt_age is not None and attempt_age < retry_after):
            state["alert_attempt_at"] = previous["alert_attempt_at"]
        else:
            state["alert_attempt_at"] = now
            write_json(STATE / "ops-status.json", state)
            try:
                state["alert_delivery"] = send_alert(config)
                if state["alert_delivery"] == "sent":
                    state["alert_sent_at"] = now
            except Exception:
                state["alert_delivery"] = "failed"
        print("RECOVERY UNHEALTHY; check private unit status and ops-status.json", file=sys.stderr)
    write_json(STATE / "ops-status.json", state)


def status(config):
    snapshot = read_json(STATE / "ops-status.json")
    elapsed = age(snapshot, "checked_at", time.time())
    if health_reasons(config) or snapshot.get("ok") is not True or elapsed is None or elapsed > 180:
        raise ValueError("Backup, restore or monitoring is unhealthy")


def begin_backup(_config):
    previous = read_json(STATE / "backup-attempt.json")
    now = time.time()
    elapsed = age(previous, "started_at", now)
    # ExecStartPre and the locked runner both call this. Preserve healthy grace
    # across those two starts, but never clear a failed/interrupted attempt.
    previous_ok = (previous.get("ok") is True or
                   (previous.get("running") is True and previous.get("previous_ok") is True and
                    elapsed is not None and elapsed <= 46 * 60))
    write_json(STATE / "backup-attempt.json", {"ok": False, "running": True,
                                              "previous_ok": previous_ok, "started_at": now})


def fail_backup(config):
    if os.environ.get("SERVICE_RESULT") != "success":
        write_json(STATE / "backup-attempt.json", {"ok": False})
        monitor(config)


def begin_drill(_config):
    # Run before the job lock so a refused overlapping drill stays recorded.
    write_json(STATE / "drill.json", {"ok": False})


def validate_state():
    if STATE.is_symlink() or not STATE.is_dir() or STATE.stat().st_mode & 0o077 or STATE.stat().st_uid != 0:
        raise ValueError("State must be root-owned and private")


def main():
    os.umask(0o077)
    operation = sys.argv[1] if len(sys.argv) >= 2 else ""
    try:
        if operation not in ("backup", "drill", "metrics", "cleanup-drill", "begin-drill", "prune-dry-run",
                             "status", "begin-backup", "fail-backup", "retrieve", "verify-retention-locks"):
            raise ValueError("Expected operation")
        if len(sys.argv) != (4 if operation == "retrieve" else 2):
            raise ValueError("Unexpected operation arguments")
        validate_state()
        config = read_json(Path("/etc/infraforge/ops/config.json"))
        validate_config(config)
        if operation == "backup":
            begin_backup(config)
        if operation == "retrieve":
            target = Path(sys.argv[3])
            target.mkdir(mode=0o700)  # Refuse an existing destination, including symlinks.
            retrieve(config, sys.argv[2], target)
        else:
            globals()[operation.replace("-", "_")](config)
        if operation == "backup":
            write_json(STATE / "backup-attempt.json", {"ok": True})
            monitor(config)
        elif operation == "drill":
            monitor(config)
    except Exception:
        if operation in ("backup", "begin-backup", "fail-backup"):
            try:
                write_json(STATE / "backup-attempt.json", {"ok": False})
                monitor(locals().get("config", {}))
            except Exception:
                print("BACKUP FAILURE STATE COULD NOT BE UPDATED; operator action required", file=sys.stderr)
        elif operation in ("drill", "begin-drill", "cleanup-drill"):
            try:
                write_json(STATE / "drill.json", {"ok": False})
                monitor(locals().get("config", {}))
            except Exception:
                print("RESTORE FAILURE STATE COULD NOT BE UPDATED; operator action required", file=sys.stderr)
        # No exception string: URL parsers, pg tools and AWS errors can contain secrets.
        print("Operations job failed; inspect configuration, private backup diagnostics and unit status", file=sys.stderr)
        return 1
    print(f"{operation.upper()} PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
