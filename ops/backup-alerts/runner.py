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
MAX_OBJECT_BYTES = 5_000_000_000  # Single PUT: no multipart/list/abort IAM permissions.
CREDENTIALS = Path("/etc/infraforge/ops/r2.credentials")
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
    temporary = path.with_suffix(".partial")
    temporary.write_text(json.dumps(value) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def validate_config(config):
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


def private_credentials():
    # Check the opened file, not a path subsequently reopened by the CLI.
    fd = os.open(CREDENTIALS, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError("Credentials require root ownership and mode 0600")
        parser = configparser.ConfigParser(interpolation=None)
        parser.read_file(source)
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


def prune(config, now=None, dry_run=False):
    cutoff = (time.time() if now is None else now) - RETENTION_SECONDS
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
                if object_time(item["LastModified"]) < cutoff:
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
        if previous.get("week") != week:
            upload(config, bundle, f"backups/weekly/{week}-{suffix}.tar")
        prune(config, started)
        # Receipt advances only after every required PUT succeeds; age starts at dump start.
        write_json(STATE / "backup.json", {"snapshot_at": started, "archive": archive.name,
                                          "daily_key": daily, "week": week})
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
    if elapsed is None or elapsed > 93600 or not re.fullmatch(r"backup\.[A-Za-z0-9]+", receipt.get("archive", "")):
        raise ValueError("Fresh uploaded archive required for drill")
    archive = STATE / "backups" / receipt["archive"]
    verify_archive(archive)
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
    write_json(STATE / "drill.json", {"ok": True, "passed_at": time.time()})


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
        pass  # Omit unknown observations; alarms treat missing as breaching.
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
    write_json(STATE / "metrics.json", {"observed_at": time.time(), "values": collect(config)})


def begin_drill(_config):
    # Run by systemd before the job lock: even a refused overlapping attempt alerts.
    write_json(STATE / "drill.json", {"ok": False})


def main():
    os.umask(0o077)
    operation = sys.argv[1] if len(sys.argv) == 2 else ""
    try:
        if operation not in ("backup", "drill", "metrics", "cleanup-drill", "begin-drill", "prune-dry-run"):
            raise ValueError("Expected operation")
        if STATE.is_symlink() or STATE.stat().st_mode & 0o077:
            raise ValueError("State must be private")
        config = read_json(Path("/etc/infraforge/ops/config.json"))
        validate_config(config)
        globals()[operation.replace("-", "_")](config)
    except Exception:
        # No exception string: URL parsers, pg tools and AWS errors can contain secrets.
        print("Operations job failed; inspect configuration, private backup diagnostics and unit status", file=sys.stderr)
        return 1
    print(f"{operation.upper()} PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
