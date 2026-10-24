"""Offline regressions: all external commands and HTTP requests are mocked."""
import contextlib
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import tarfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("ops_runner", Path(__file__).with_name("runner.py"))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)
PRIVATE_CREDENTIALS = ops.private_credentials
CONFIG = {"region": "auto", "endpoint_url": "https://storage.example.invalid", "bucket": "fixture-backups",
          "site_url": "https://site.example.invalid/", "api_url": "https://api.example.invalid/health/ready",
          "worker_container": "fixture-worker", "drill_image": "postgres:18@sha256:" + "a" * 64}
URL = "postgresql://fixture:synthetic%24password@ep-fixture.us-east-1.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require"
NOW = dt.datetime(2026, 10, 20, 2, 15, tzinfo=dt.timezone.utc).timestamp()


class OperationsTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).resolve().parents[2] / ".agent"
        scratch.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name)
        self.addCleanup(patch.stopall)
        patch.object(ops, "STATE", self.state).start()
        patch.object(ops, "private_credentials", return_value=("fixture-access", "fixture-secret")).start()
        patch.object(socket, "socket", side_effect=AssertionError("Network forbidden in offline tests")).start()
        self.calls = []
        self.objects = {}

    def archive(self, name="backup.fixture"):
        root = self.state / "backups"
        root.mkdir(exist_ok=True)
        archive = root / name
        archive.mkdir(exist_ok=True)
        content = b"synthetic custom dump placeholder"
        (archive / "archive.dump").write_bytes(content)
        (archive / "SHA256SUMS").write_text(hashlib.sha256(content).hexdigest() + "  archive.dump\n")
        return archive

    def fake_command(self, args, *, env=None, seconds=60):
        self.calls.append((args, env, seconds))
        if args[0] == "bash" and args[1].endswith("postgres-backup.sh"):
            return f"BACKUP PASS {self.archive()}\n".encode()
        if args[0] == "aws":
            if "list-objects-v2" in args:
                return b'{"IsTruncated": false}'
            key = args[args.index("--key") + 1]
            if "put-object" in args:
                if key in self.objects:
                    raise subprocess.CalledProcessError(1, "fixture-precondition")
                self.objects[key] = Path(args[args.index("--body") + 1]).read_bytes()
            elif "head-object" in args:
                return json.dumps({"ContentLength": len(self.objects[key]), "ETag": '"fixture"'}).encode()
            elif "get-object" in args:
                Path(args[-1]).write_bytes(self.objects[key])
        return b""

    def backup(self, now=NOW):
        with patch.dict(os.environ, {"BACKUP_DATABASE_URL": URL}, clear=True), patch.object(ops, "command", self.fake_command):
            ops.backup(CONFIG, now)

    def test_direct_url_and_clean_libpq_environment(self):
        with patch.dict(os.environ, {"PGHOSTADDR": "redirect", "PGSERVICE": "redirect", "SECRET_MARKER": "synthetic"}):
            env = ops.source_env(URL)
        self.assertEqual(env["PGSSLMODE"], "verify-full")
        self.assertEqual(env["PGSSLROOTCERT"], "system")
        self.assertEqual(env["PGPASSWORD"], "synthetic$password")
        self.assertFalse({"PGHOSTADDR", "PGSERVICE", "SECRET_MARKER", "BACKUP_DATABASE_URL"} & env.keys())

    def test_pooled_remote_routing_and_weak_tls_refused(self):
        for bad in [URL.replace("ep-fixture.", "ep-fixture-pooler."),
                    URL + "&hostaddr=127.0.0.1", URL + "&service=redirect",
                    URL.replace("sslmode=verify-full", "sslmode=disable"),
                    URL.replace("channel_binding=require", "channel_binding=disable"),
                    URL.replace("postgresql:", "https:"), URL + "#fragment"]:
            with self.subTest(url_variant=bad.split("@")[-1]), self.assertRaisesRegex(ValueError, "Invalid direct PostgreSQL"):
                ops.source_env(bad)

    def test_remote_provider_and_private_service_policy(self):
        remote = "postgresql://fixture:password@db.example.invalid:6543/app?sslmode=verify-full"
        self.assertEqual(ops.source_env(remote)["PGPORT"], "6543")
        self.assertEqual(ops.source_env(remote)["PGCHANNELBINDING"], "prefer")
        with patch.object(ops, "command") as run:
            ops.local_source(ops.source_env(remote))
            ops.local_source(ops.source_env(remote.replace("db.example.invalid:6543", "postgres:6432")))
            run.assert_not_called()
        local = "postgresql://fixture:password@postgres/app?sslmode=disable"
        self.assertEqual(ops.source_env(local)["PGSSLMODE"], "disable")
        self.assertNotIn("PGSSLROOTCERT", ops.source_env(local))
        for host in ["localhost", "127.0.0.1", "10.0.0.1", "postgres:6432", "other"]:
            with self.assertRaises(ValueError):
                ops.source_env(local.replace("@postgres/", "@" + host + "/"))
        for extra in ["&sslmode=disable", "&sslmode=verify-full", "&host=postgres", "&pgbouncer=true", "&pool_mode=transaction"]:
            with self.assertRaises(ValueError):
                ops.source_env(remote + extra)
        for bad in [remote.replace("sslmode=verify-full", "sslmode=require"), remote.split("?")[0],
                    remote.replace(":6543", ":0"), remote.replace("fixture:password@", ""),
                    remote.replace("postgresql:", "https:"), remote + "&channel_binding=", remote + "#fragment"]:
            with self.assertRaises(ValueError):
                ops.source_env(bad)

    def test_source_url_is_literal_migration_url_from_release_credential(self):
        path = self.state / "release-env"
        with patch.dict(os.environ, {"CREDENTIALS_DIRECTORY": str(self.state)}, clear=True):
            path.write_text('OTHER=ignored\nMIGRATION_DATABASE_URL="' + URL + '"\n')
            self.assertEqual(ops.source_url(), URL)
            for content in ["OTHER=ignored", "MIGRATION_DATABASE_URL=" + URL + "\nMIGRATION_DATABASE_URL=" + URL,
                            "MIGRATION_DATABASE_URL=${REDIRECT}", "MIGRATION_DATABASE_URL=some url"]:
                path.write_text(content)
                with self.assertRaises(ValueError):
                    ops.source_url()

    def test_local_backup_checks_container_and_internal_network_ownership(self):
        db = {"Config": {"Labels": {"com.docker.compose.project": "infraforge", "com.docker.compose.service": "postgres"}},
              "State": {"Running": True}, "HostConfig": {"PortBindings": {}},
              "NetworkSettings": {"Networks": {"private": {"NetworkID": "network", "IPAddress": "172.20.0.2"}}}}
        network = {"Internal": True, "Driver": "bridge", "Labels": {"com.docker.compose.project": "infraforge"}}
        ids = b"owned"
        def inspect(args, **kwargs):
            self.assertNotIn("PGPASSWORD", kwargs["env"])
            if args[1] == "ps":
                return ids
            return json.dumps([network] if args[1] == "network" else [db]).encode()
        with patch.object(ops, "command", inspect):
            env = ops.source_env("postgresql://fixture:password@postgres/app")
            ops.local_source(env)
            self.assertEqual(env["PGHOSTADDR"], "172.20.0.2")
            for target, key, bad in [(db["Config"]["Labels"], "com.docker.compose.project", "other"),
                    (db["Config"]["Labels"], "com.docker.compose.service", "other"),
                    (db["State"], "Running", False), (db["HostConfig"], "PortBindings", {"5432/tcp": [{}]}),
                    (network, "Internal", False), (network, "Driver", "host"),
                    (network["Labels"], "com.docker.compose.project", "other"),
                    (db["NetworkSettings"]["Networks"]["private"], "IPAddress", "8.8.8.8")]:
                old = target[key]; target[key] = bad
                with self.assertRaises(ValueError):
                    ops.local_source(ops.source_env("postgresql://fixture:password@postgres/app"))
                target[key] = old
            for ids in [b"", b"one two"]:
                with self.assertRaises(ValueError):
                    ops.local_source(ops.source_env("postgresql://fixture:password@postgres/app"))

    def test_reboot_waits_for_container_and_authenticated_sql_before_dump(self):
        db = {"Config": {"Labels": {"com.docker.compose.project": "infraforge", "com.docker.compose.service": "postgres"}},
              "State": {"Running": True}, "HostConfig": {"PortBindings": {}},
              "NetworkSettings": {"Networks": {"private": {"NetworkID": "network", "IPAddress": "172.20.0.2"}}}}
        network = {"Internal": True, "Driver": "bridge", "Labels": {"com.docker.compose.project": "infraforge"}}
        counts = {"ps": 0, "sql": 0}
        events = []
        def recovering(args, **kwargs):
            events.append(args[0])
            if args[0] == "docker":
                self.assertNotIn("PGPASSWORD", kwargs["env"])
                if args[1] == "ps":
                    counts["ps"] += 1
                    return b"" if counts["ps"] == 1 else b"owned"
                return json.dumps([network] if args[1] == "network" else [db]).encode()
            if args[0] == "psql":
                counts["sql"] += 1
                self.assertEqual(kwargs["env"]["PGHOSTADDR"], "172.20.0.2")
                self.assertEqual(kwargs["env"]["PGPASSWORD"], "synthetic")
                self.assertIn("--no-password", args)
                if counts["sql"] == 1:
                    raise subprocess.CalledProcessError(1, "mock recovery")
                return b"1\n"
            return self.fake_command(args, **kwargs)
        with patch.dict(os.environ, {"BACKUP_DATABASE_URL": "postgresql://fixture:synthetic@postgres/app"}, clear=True), \
                patch.object(ops, "command", recovering), patch.object(ops.time, "sleep") as sleep:
            ops.backup(CONFIG, NOW)
        self.assertEqual(counts, {"ps": 3, "sql": 2})
        self.assertEqual(sleep.call_count, 2)
        self.assertLess(max(i for i, item in enumerate(events) if item == "psql"), events.index("bash"))
        self.assertEqual(ops.read_json(self.state / "backup.json")["snapshot_at"], NOW)

    def test_startup_timeout_preserves_receipt_and_archive_without_dump_or_upload(self):
        self.archive("backup.old")
        receipt = {"snapshot_at": NOW - 86400, "archive": "backup.old"}
        ops.write_json(self.state / "backup.json", receipt)
        clock = [0]
        def advance(seconds):
            clock[0] += seconds
        with patch.dict(os.environ, {"BACKUP_DATABASE_URL": "postgresql://fixture:synthetic@postgres/app"}, clear=True), \
                patch.object(ops, "command", return_value=b"") as run, \
                patch.object(ops.time, "monotonic", side_effect=lambda: clock[0]), \
                patch.object(ops.time, "sleep", side_effect=advance):
            with self.assertRaisesRegex(TimeoutError, "deadline"):
                ops.backup(CONFIG, NOW)
        self.assertEqual(clock[0], 180)
        self.assertTrue(all(call.args[0][:2] == ["docker", "ps"] for call in run.call_args_list))
        self.assertEqual(ops.read_json(self.state / "backup.json"), receipt)
        self.assertTrue((self.state / "backups/backup.old/archive.dump").exists())

    def test_startup_wait_does_not_retry_unsafe_container(self):
        with patch.object(ops, "command", return_value=b"one two"), patch.object(ops.time, "sleep") as sleep:
            with self.assertRaises(ValueError):
                ops.wait_local_source(ops.source_env("postgresql://fixture:synthetic@postgres/app"))
        sleep.assert_not_called()

    def test_backup_unit_requires_docker_before_persistent_timer_catchup(self):
        unit = Path(__file__).with_name("systemd").joinpath("infraforge-backup.service").read_text()
        self.assertIn("Requires=docker.service", unit)
        self.assertIn("After=network-online.target docker.service", unit)

    def test_daily_and_weekly_put_only_checked_bundle_to_explicit_endpoint(self):
        import tarfile
        original = self.fake_command
        def check(args, **kwargs):
            if "put-object" in args:
                self.assertEqual(args[args.index("--endpoint-url") + 1], CONFIG["endpoint_url"])
                self.assertEqual(args[args.index("--region") + 1], "auto")
                self.assertEqual(args[args.index("--if-none-match") + 1], "*")
                self.assertIn("--content-md5", args)
                self.assertNotIn("--server-side-encryption", args)
                with tarfile.open(args[args.index("--body") + 1]) as tar:
                    self.assertEqual(tar.getnames(), ["archive.dump", "SHA256SUMS"])
                self.assertNotIn("PGPASSWORD", kwargs["env"])
                self.assertEqual(kwargs["env"]["AWS_ACCESS_KEY_ID"], "fixture-access")
                self.assertEqual(kwargs["env"]["AWS_EC2_METADATA_DISABLED"], "true")
                self.assertNotIn("fixture-secret", args)
            return original(args, **kwargs)
        with patch.object(ops, "command", check), patch.dict(os.environ, {"BACKUP_DATABASE_URL": URL}, clear=True):
            ops.backup(CONFIG, NOW)
        uploads = [args for args, _, _ in self.calls if "put-object" in args]
        keys = [args[args.index("--key") + 1] for args in uploads]
        self.assertEqual(len(keys), 2)
        self.assertRegex(keys[0], r"^backups/daily/2026-10-20-[0-9a-f]{32}\.tar$")
        self.assertRegex(keys[1], r"^backups/weekly/2026-W43-[0-9a-f]{32}\.tar$")
        self.assertEqual(ops.read_json(self.state / "backup.json")["snapshot_at"], NOW)
        self.assertFalse((self.state / "backups/backup.fixture/backup.tar").exists())

    def test_existing_week_only_uploads_daily_and_removes_old_local_copy(self):
        self.archive("backup.old")
        ops.write_json(self.state / "backup.json", {"archive": "backup.old", "week": "2026-W43", "storage": ops.storage_identity(CONFIG)})
        self.backup()
        self.assertEqual(sum("put-object" in args for args, _, _ in self.calls), 1)
        self.assertFalse((self.state / "backups/backup.old").exists())

    def test_failed_weekly_upload_preserves_previous_receipt_and_local_copy(self):
        self.archive("backup.old")
        receipt = {"snapshot_at": NOW - 86400, "archive": "backup.old", "week": "2026-W42"}
        ops.write_json(self.state / "backup.json", receipt)
        original = self.fake_command
        def fail_weekly(args, **kwargs):
            if any("backups/weekly" in arg for arg in args):
                raise subprocess.CalledProcessError(1, "mock-aws")
            return original(args, **kwargs)
        with patch.object(ops, "command", fail_weekly), patch.dict(os.environ, {"BACKUP_DATABASE_URL": URL}, clear=True):
            with self.assertRaises(subprocess.CalledProcessError):
                ops.backup(CONFIG, NOW)
        self.assertEqual(ops.read_json(self.state / "backup.json"), receipt)
        self.assertTrue((self.state / "backups/backup.old/archive.dump").exists())
        self.assertFalse((self.state / "backups/backup.fixture/backup.tar").exists())

    def test_failed_dump_never_uploads_or_writes_receipt(self):
        with patch.object(ops, "command", side_effect=subprocess.TimeoutExpired("mock-dump", 700)), patch.dict(os.environ, {"BACKUP_DATABASE_URL": URL}, clear=True):
            with self.assertRaises(subprocess.TimeoutExpired):
                ops.backup(CONFIG, NOW)
        self.assertFalse((self.state / "backup.json").exists())

    def test_oversized_upload_refused_before_aws(self):
        archive = self.archive()
        with patch.object(ops, "MAX_OBJECT_BYTES", 1), patch.object(ops, "s3") as aws:
            with self.assertRaises(ValueError):
                ops.upload(CONFIG, archive / "archive.dump", "backups/daily/2026-10-20.tar")
            aws.assert_not_called()

    def test_checksum_corruption_refused(self):
        archive = self.archive()
        (archive / "archive.dump").write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "checksum"):
            ops.verify_archive(archive)

    def metrics(self, receipt=None, drill=None):
        if receipt is not None:
            ops.write_json(self.state / "backup.json", receipt)
        if drill is not None:
            ops.write_json(self.state / "drill.json", drill)
        meminfo = self.state / "meminfo"
        meminfo.write_text("MemTotal:       4000 kB\nMemAvailable:   1000 kB\n")
        with patch.object(ops, "ready", return_value=1), patch.object(ops, "command", self.fake_command), patch.object(shutil, "disk_usage", return_value=shutil._ntuple_diskusage(100, 81, 19)):
            return {item["MetricName"]: item["Value"] for item in ops.collect(CONFIG, NOW, meminfo)}

    def test_missing_backup_is_unknown_and_drill_unhealthy(self):
        values = self.metrics()
        self.assertNotIn("BackupAgeSeconds", values)
        self.assertEqual(values["RestoreDrillHealthy"], 0)
        self.assertEqual(values["DiskUsedPercent"], 81)
        self.assertEqual(values["MemoryUsedPercent"], 75)

    def test_stale_backup_and_old_drill(self):
        values = self.metrics({"snapshot_at": NOW - 93601}, {"ok": True, "passed_at": NOW - 36 * 86400})
        self.assertEqual(values["BackupAgeSeconds"], 93601)
        self.assertEqual(values["RestoreDrillHealthy"], 0)

    def test_future_timestamp_not_fresh(self):
        self.assertNotIn("BackupAgeSeconds", self.metrics({"snapshot_at": NOW + 1}))

    def test_failed_or_interrupted_drill_latches_until_success(self):
        values = self.metrics(drill={"ok": False, "passed_at": NOW - 10})
        self.assertEqual(values["RestoreDrillHealthy"], 0)
        self.assertEqual(self.metrics(drill={"ok": True, "passed_at": NOW - 10})["RestoreDrillHealthy"], 1)

    def test_worker_timeout_emits_unhealthy_without_diagnostic(self):
        with patch.object(ops, "ready", return_value=1), patch.object(ops, "command", side_effect=subprocess.TimeoutExpired("mock-worker", 8)):
            values = ops.collect(CONFIG, NOW, self.state / "absent")
        self.assertEqual(next(item["Value"] for item in values if item["MetricName"] == "WorkerReady"), 0)
        self.assertFalse(any(item["MetricName"] == "MemoryUsedPercent" for item in values))

    def test_http_readiness_requires_success_json(self):
        response = unittest.mock.MagicMock()
        response.status = 200
        response.url = CONFIG["api_url"]
        response.__enter__.return_value = response
        with patch.object(ops.urllib.request, "urlopen", return_value=response):
            for body in (b'{"success":false}', b'[]', b'null', b'not-json'):
                response.read.return_value = body
                self.assertEqual(ops.ready(CONFIG["api_url"], True), 0)
            response.read.return_value = b'{"success":true}'
            self.assertEqual(ops.ready(CONFIG["api_url"], True), 1)

    def test_restore_reuses_proof_and_hardened_restore_with_no_source_credentials(self):
        archive = self.archive()
        key = self.remote_archive(archive)
        ops.write_json(self.state / "backup.json", {"snapshot_at": NOW - 60, "daily_key": key, "storage": ops.storage_identity(CONFIG)})
        # A successful drill must not depend on the local staging archive.
        shutil.rmtree(archive)
        with patch.object(ops.time, "time", return_value=NOW), patch.object(ops, "command", self.fake_command), patch.dict(os.environ, {"PGPASSWORD": "synthetic", "BACKUP_DATABASE_URL": URL}):
            ops.drill(CONFIG)
        self.assertTrue(ops.read_json(self.state / "drill.json")["ok"])
        self.assertTrue(any("get-object" in args for args, _, _ in self.calls))
        self.assertTrue(any(args[0] == "bash" and args[1].endswith("prove-backup.sh") for args, _, _ in self.calls))
        self.assertTrue(any("/restore/verify.sh" in args and "local-only" in " ".join(args) for args, _, _ in self.calls))
        run = next(args for args, _, _ in self.calls if args[:2] == ["docker", "run"])
        self.assertEqual(run[run.index("--network") + 1], "none")
        self.assertFalse((self.state / "drill-container.json").exists())
        for args, env, _ in self.calls:
            self.assertNotIn("PGPASSWORD", env)
            self.assertNotIn("BACKUP_DATABASE_URL", env)
            if args[0] != "aws":
                self.assertNotIn("AWS_SECRET_ACCESS_KEY", env)

    def remote_archive(self, archive):
        content = io.BytesIO()
        with tarfile.open(fileobj=content, mode="w") as tar:
            for name in ("archive.dump", "SHA256SUMS"):
                tar.add(archive / name, arcname=name)
        key = "backups/daily/2026-10-20.tar"
        self.objects[key] = content.getvalue()
        return key

    def test_restore_failure_cleans_container_and_latches_failure(self):
        archive = self.archive()
        key = self.remote_archive(archive)
        ops.write_json(self.state / "backup.json", {"snapshot_at": NOW - 60, "daily_key": key, "storage": ops.storage_identity(CONFIG)})
        def fail_restore(args, **kwargs):
            result = self.fake_command(args, **kwargs)
            if "/restore/verify.sh" in args:
                raise subprocess.CalledProcessError(1, "mock-restore")
            return result
        with patch.object(ops.time, "time", return_value=NOW), patch.object(ops, "command", fail_restore):
            with self.assertRaises(subprocess.CalledProcessError):
                ops.drill(CONFIG)
        self.assertEqual(ops.read_json(self.state / "drill.json"), {"ok": False})
        self.assertTrue(any(args[:3] == ["docker", "rm", "-fv"] for args, _, _ in self.calls))

    def test_stale_restore_source_never_starts_docker(self):
        ops.write_json(self.state / "backup.json", {"snapshot_at": NOW - 93601, "storage": ops.storage_identity(CONFIG),
                                                    "daily_key": "backups/daily/2026-10-20.tar"})
        with patch.object(ops.time, "time", return_value=NOW), patch.object(ops, "command") as command:
            with self.assertRaises(ValueError):
                ops.drill(CONFIG)
            command.assert_not_called()

    def test_new_storage_target_forces_weekly_copy_even_with_old_receipt(self):
        for previous_storage in [None, ops.storage_identity({**CONFIG, "bucket": "old-bucket"})]:
            self.calls.clear()
            ops.write_json(self.state / "backup.json", {"week": "2026-W43", "storage": previous_storage})
            self.backup()
            self.assertEqual(sum("put-object" in args for args, _, _ in self.calls), 2)
            receipt = ops.read_json(self.state / "backup.json")
            self.assertEqual(receipt["storage"], ops.storage_identity(CONFIG))
            self.assertTrue(receipt["weekly_key"].startswith("backups/weekly/"))

    def test_old_target_receipt_cannot_report_health_or_start_restore(self):
        self.healthy_receipt()
        other = {**CONFIG, "endpoint_url": "https://different.example.invalid"}
        with patch.object(ops.time, "time", return_value=NOW), patch.object(ops, "command") as command:
            self.assertFalse(ops.backup_healthy(other))
            with self.assertRaises(ValueError):
                ops.drill(other)
            command.assert_not_called()

    def test_state_refuses_wrong_owner_public_modes_symlinks_and_non_directories(self):
        state = unittest.mock.MagicMock()
        with patch.object(ops, "STATE", state):
            for owner, mode, symlink, directory in [(0, 0o700, False, True), (1, 0o700, False, True),
                    (0, 0o755, False, True), (0, 0o700, True, True), (0, 0o700, False, False)]:
                state.is_symlink.return_value = symlink
                state.is_dir.return_value = directory
                state.stat.return_value = types.SimpleNamespace(st_uid=owner, st_mode=mode)
                if owner == 0 and mode == 0o700 and not symlink and directory:
                    ops.validate_state()
                else:
                    with self.assertRaises(ValueError):
                        ops.validate_state()

    def test_cleanup_refuses_unowned_container_name(self):
        ops.write_json(self.state / "drill-container.json", {"name": "production"})
        with patch.object(ops, "command") as command:
            with self.assertRaises(ValueError):
                ops.cleanup_drill(CONFIG)
            command.assert_not_called()

    def test_main_logs_no_exception_details(self):
        stderr = io.StringIO()
        with patch.object(ops.sys, "argv", ["runner.py", "metrics"]), patch.object(ops.Path, "stat", side_effect=RuntimeError(URL)), contextlib.redirect_stderr(stderr):
            self.assertEqual(ops.main(), 1)
        self.assertNotIn(URL, stderr.getvalue())
        self.assertIn("Operations job failed", stderr.getvalue())

    def test_config_refuses_injected_commands_and_credentials(self):
        ops.validate_config(CONFIG)
        for key, value in [("worker_container", "--privileged"), ("region", "us-east-1;bad"),
                           ("site_url", "https://user:synthetic@site.example.invalid"),
                           ("api_url", "http://api.example.invalid"), ("drill_image", "postgres:latest")]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                ops.validate_config({**CONFIG, key: value})

    def test_endpoint_must_be_explicit_credential_free_https_origin(self):
        for value in ["", "http://storage.example.invalid", "https://key:secret@storage.example.invalid",
                      "https://storage.example.invalid/bucket", "https://storage.example.invalid?token=secret",
                      "https://storage.example.invalid#fragment"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                ops.validate_config({**CONFIG, "endpoint_url": value})
        missing = dict(CONFIG)
        del missing["endpoint_url"]
        with self.assertRaises(ValueError):
            ops.validate_config(missing)

    def test_conditional_upload_refuses_overwrite_and_checks_readback(self):
        bundle = self.archive() / "archive.dump"
        key = "backups/daily/2026-10-20.tar"
        with patch.object(ops, "command", self.fake_command):
            ops.upload(CONFIG, bundle, key)
            with self.assertRaises(subprocess.CalledProcessError):
                ops.upload(CONFIG, bundle, key)
        original = self.fake_command
        def corrupt(args, **kwargs):
            result = original(args, **kwargs)
            if "get-object" in args:
                target = Path(args[-1])
                target.write_bytes(b"x" * target.stat().st_size)
            return result
        with patch.object(ops, "command", corrupt), self.assertRaisesRegex(ValueError, "checksum"):
            ops.upload(CONFIG, bundle, "backups/daily/2026-10-21.tar")

    def listing(self, items):
        def storage(_config, args, **_kwargs):
            self.calls.append(args)
            if "list-objects-v2" in args:
                prefix = args[args.index("--prefix") + 1]
                return json.dumps({"IsTruncated": False, "Contents": [item for item in items if item["Key"].startswith(prefix)]}).encode()
            if "head-object" in args:
                key = args[args.index("--key") + 1]
                return json.dumps(next(item for item in items if item["Key"] == key)).encode()
            return b"{}"
        return storage

    def test_prune_dry_run_and_strict_28_day_boundary(self):
        def item(key, seconds):
            return {"Key": key, "LastModified": dt.datetime.fromtimestamp(NOW - seconds, dt.timezone.utc).isoformat()}
        old = "backups/daily/2026-09-01.tar"
        items = [item(old, ops.RETENTION_SECONDS + 1),
                 item("backups/daily/2026-09-02.tar", ops.RETENTION_SECONDS),
                 item("backups/weekly/2026-W42.tar", 1),
                 item("unrelated/keep.tar", ops.RETENTION_SECONDS + 100)]
        with patch.object(ops, "s3", self.listing(items)):
            self.assertEqual(ops.prune(CONFIG, NOW, dry_run=True), [old])
            self.assertFalse(any("delete-object" in args for args in self.calls))
            self.assertEqual(ops.prune(CONFIG, NOW), [old])
        deletes = [args[args.index("--key") + 1] for args in self.calls if "delete-object" in args]
        self.assertEqual(deletes, [old])

    def test_prune_rejects_escaped_keys_before_any_deletion(self):
        for key in ["other/2026-01-01.tar", "backups/daily/../private.tar", "backups/daily/private.txt",
                    "backups/weekly/2026-W01.tar"]:
            self.calls.clear()
            def escaped(_config, args, **_kwargs):
                self.calls.append(args)
                return json.dumps({"IsTruncated": False, "Contents": [{"Key": key, "LastModified": "2025-01-01T00:00:00Z"}]}).encode()
            with patch.object(ops, "s3", escaped), self.assertRaises(ValueError):
                ops.prune(CONFIG, NOW)
            self.assertFalse(any("delete-object" in args for args in self.calls))

    def test_prune_bounds_pages_and_deletions(self):
        for pages in [True, False]:
            self.calls.clear()
            def huge(_config, args, **_kwargs):
                self.calls.append(args)
                items = [] if pages else [{"Key": f"backups/daily/2025-01-01-{i:032x}.tar", "LastModified": "2025-01-01T00:00:00Z"} for i in range(129)]
                return json.dumps({"IsTruncated": pages, "NextContinuationToken": str(len(self.calls)), "Contents": items}).encode()
            with patch.object(ops, "s3", huge), self.assertRaises(ValueError):
                ops.prune(CONFIG, NOW)
            self.assertLessEqual(len(self.calls), ops.MAX_LIST_PAGES)
            self.assertFalse(any("delete-object" in args for args in self.calls))

    def test_prune_rechecks_remote_age_before_delete(self):
        items = [{"Key": "backups/daily/2025-01-01.tar", "LastModified": "2025-01-01T00:00:00Z"}]
        original = self.listing(items)
        def changed(config, args, **kwargs):
            if "head-object" in args:
                return b'{"LastModified":"2026-10-20T00:00:00Z"}'
            return original(config, args, **kwargs)
        with patch.object(ops, "s3", changed), self.assertRaises(ValueError):
            ops.prune(CONFIG, NOW)
        self.assertFalse(any("delete-object" in args for args in self.calls))

    def test_remote_retrieval_refuses_unknown_oversize_and_incomplete_content(self):
        for size in [0, None, ops.MAX_OBJECT_BYTES + 1]:
            with patch.object(ops, "s3", return_value=json.dumps({"ContentLength": size, "ETag": '"fixture"'}).encode()) as storage:
                with self.assertRaises(ValueError):
                    ops.download(CONFIG, "backups/daily/2026-10-20.tar", self.state / "download.tar")
                self.assertEqual(storage.call_count, 1)

    def test_private_credentials_checks_opened_file_owner_mode_and_exact_pair(self):
        fixture = self.state / "fixture.credentials"
        fixture.write_text("[default]\naws_access_key_id=fixture-access\naws_secret_access_key=fixture-secret\n")
        with patch.object(ops, "CREDENTIALS", fixture), patch.object(ops.os, "O_NOFOLLOW", 0, create=True):
            for uid, mode in [(0, 0o100600), (1, 0o100600), (0, 0o100644), (0, 0o040600)]:
                with patch.object(ops.os, "fstat", return_value=types.SimpleNamespace(st_uid=uid, st_mode=mode)):
                    if uid == 0 and mode == 0o100600:
                        self.assertEqual(PRIVATE_CREDENTIALS(), ["fixture-access", "fixture-secret"])
                    else:
                        with self.assertRaises(ValueError):
                            PRIVATE_CREDENTIALS()
            with patch.object(ops.os, "fstat", return_value=types.SimpleNamespace(st_uid=0, st_mode=0o100600)):
                for text in ["[default]\naws_access_key_id=fixture\n", "[other]\naws_access_key_id=fixture\naws_secret_access_key=fixture\n",
                             "[default]\naws_access_key_id=fixture\naws_secret_access_key=fixture\naws_session_token=extra\n"]:
                    fixture.write_text(text)
                    with self.assertRaises(ValueError):
                        PRIVATE_CREDENTIALS()

    def test_retrieve_rejects_paths_links_duplicates_and_corrupt_dump(self):
        for names in [["../escape", "SHA256SUMS"], ["archive.dump", "archive.dump"],
                      ["archive.dump", "SHA256SUMS", "extra"], ["archive.dump", "SHA256SUMS"]]:
            for symlink in [False, True]:
                content = io.BytesIO()
                with tarfile.open(fileobj=content, mode="w") as tar:
                    for name in names:
                        item = tarfile.TarInfo(name)
                        if symlink:
                            item.type = tarfile.SYMTYPE
                            item.linkname = "../escape"
                            tar.addfile(item)
                        else:
                            item.size = 7
                            tar.addfile(item, io.BytesIO(b"corrupt"))
                key = "backups/daily/2026-10-20.tar"
                self.objects[key] = content.getvalue()
                with tempfile.TemporaryDirectory(dir=self.state) as work, patch.object(ops, "command", self.fake_command):
                    with self.assertRaises(ValueError):
                        ops.retrieve(CONFIG, key, Path(work))
                self.assertFalse((self.state / "escape").exists())

    def healthy_receipt(self):
        ops.write_json(self.state / "backup.json", {"snapshot_at": NOW - 60, "storage": ops.storage_identity(CONFIG)})
        ops.write_json(self.state / "backup-attempt.json", {"ok": True})

    def test_monitor_alerts_on_missing_stale_future_and_failed_backup(self):
        cases = [({}, {"ok": True}), ({"snapshot_at": NOW - 93601}, {"ok": True}),
                 ({"snapshot_at": NOW + 1}, {"ok": True}), ({"snapshot_at": NOW - 60}, {"ok": False})]
        for receipt, attempt in cases:
            (self.state / "ops-status.json").unlink(missing_ok=True)
            ops.write_json(self.state / "backup.json", {**receipt, "storage": ops.storage_identity(CONFIG)})
            ops.write_json(self.state / "backup-attempt.json", attempt)
            with patch.object(ops.time, "time", return_value=NOW), patch.object(ops, "send_alert", return_value="sent") as send:
                ops.monitor(CONFIG)
                send.assert_called_once_with(CONFIG)
                self.assertFalse(ops.read_json(self.state / "ops-status.json")["ok"])

    def test_monitor_latches_failure_when_mail_absent_or_provider_fails(self):
        for outcome in ["unconfigured", RuntimeError(URL)]:
            (self.state / "ops-status.json").unlink(missing_ok=True)
            kwargs = {"side_effect": outcome} if isinstance(outcome, Exception) else {"return_value": outcome}
            stderr = io.StringIO()
            with patch.object(ops.time, "time", return_value=NOW), patch.object(ops, "send_alert", **kwargs), contextlib.redirect_stderr(stderr):
                ops.monitor(CONFIG)
            state = ops.read_json(self.state / "ops-status.json")
            self.assertFalse(state["ok"])
            self.assertEqual(state["alert_delivery"], "failed" if isinstance(outcome, Exception) else "unconfigured")
            self.assertNotIn(URL, stderr.getvalue() + json.dumps(state))

    def test_monitor_deduplicates_and_retries_delivery(self):
        with patch.object(ops.time, "time", return_value=NOW), patch.object(ops, "send_alert", return_value="sent") as send:
            ops.monitor(CONFIG)
            ops.monitor(CONFIG)
            self.assertEqual(send.call_count, 1)
        with patch.object(ops.time, "time", return_value=NOW + 3601), patch.object(ops, "send_alert", return_value="sent") as send:
            ops.monitor(CONFIG)
            send.assert_called_once()
        self.healthy_receipt()
        with patch.object(ops.time, "time", return_value=NOW), patch.object(ops, "send_alert") as send:
            ops.monitor(CONFIG)
            send.assert_not_called()
            ops.status(CONFIG)

    def test_status_refuses_stale_monitor_and_expired_running_attempt(self):
        self.healthy_receipt()
        with patch.object(ops.time, "time", return_value=NOW):
            for snapshot in [{}, {"ok": True, "checked_at": NOW - 181}, {"ok": False, "checked_at": NOW - 1}]:
                ops.write_json(self.state / "ops-status.json", snapshot)
                with self.assertRaises(ValueError):
                    ops.status(CONFIG)
            for start, expected in [(NOW - 1, True), (NOW - 2761, False), (NOW + 1, False)]:
                ops.write_json(self.state / "backup-attempt.json", {"ok": False, "running": True,
                                                                  "previous_ok": True, "started_at": start})
                self.assertEqual(ops.backup_healthy(CONFIG), expected)

    def test_retry_start_does_not_clear_failed_or_interrupted_backup_latch(self):
        for previous, expected in [({"ok": True}, True), ({"ok": False}, False),
                ({"ok": False, "running": True, "previous_ok": True, "started_at": NOW - 2761}, False)]:
            self.healthy_receipt()
            ops.write_json(self.state / "backup-attempt.json", previous)
            with patch.object(ops.time, "time", return_value=NOW):
                ops.begin_backup(CONFIG)
                ops.begin_backup(CONFIG)  # systemd pre-start followed by the locked runner.
                self.assertEqual(ops.backup_healthy(CONFIG), expected)

    def test_systemd_failure_hook_records_failure_for_timeout_or_lock_refusal(self):
        self.healthy_receipt()
        with patch.dict(os.environ, {"SERVICE_RESULT": "timeout"}), patch.object(ops, "monitor") as monitor:
            ops.fail_backup(CONFIG)
            monitor.assert_called_once_with(CONFIG)
        self.assertEqual(ops.read_json(self.state / "backup-attempt.json"), {"ok": False})

    def test_backup_entrypoint_alerts_on_exception_without_leaking_details(self):
        original = ops.read_json
        def config_or_state(path):
            return CONFIG if path.name == "config.json" else original(path)
        stderr = io.StringIO()
        with patch.object(ops.sys, "argv", ["runner.py", "backup"]), patch.object(ops, "validate_state"), \
                patch.object(ops, "read_json", config_or_state), patch.object(ops, "backup", side_effect=RuntimeError(URL)), \
                patch.object(ops, "send_alert", return_value="sent") as send, \
                patch.object(ops.time, "time", return_value=NOW), contextlib.redirect_stderr(stderr):
            self.assertEqual(ops.main(), 1)
            send.assert_called_once_with(CONFIG)
        self.assertEqual(ops.read_json(self.state / "backup-attempt.json"), {"ok": False})
        self.assertFalse(ops.read_json(self.state / "ops-status.json")["ok"])
        self.assertNotIn(URL, stderr.getvalue())

    def test_credentials_open_refuses_symlinks_before_reading(self):
        with patch.object(ops.os, "O_NOFOLLOW", 131072, create=True), \
                patch.object(ops.os, "open", side_effect=OSError("fixture symlink")) as opened:
            with self.assertRaises(OSError):
                PRIVATE_CREDENTIALS()
            self.assertTrue(opened.call_args.args[1] & 131072)

    def test_get_is_pinned_to_head_etag_and_checks_byte_count(self):
        def incomplete(_config, args, **_kwargs):
            if "head-object" in args:
                return b'{"ContentLength":10,"ETag":"fixture-etag"}'
            self.assertEqual(args[args.index("--if-match") + 1], "fixture-etag")
            Path(args[-1]).write_bytes(b"short")
            return b"{}"
        with patch.object(ops, "s3", incomplete), self.assertRaisesRegex(ValueError, "Incomplete"):
            ops.download(CONFIG, "backups/daily/2026-10-20.tar", self.state / "download.tar")

    def test_resend_uses_existing_literal_mail_settings_and_redacts_failures(self):
        path = self.state / "release-env"
        path.write_text('TRANSACTIONAL_EMAIL_PROVIDER=resend\nTRANSACTIONAL_EMAIL_FROM=ops@example.invalid\nRESEND_API_KEY="fixture-resend-key"\n')
        opener = unittest.mock.MagicMock()
        response = opener.open.return_value.__enter__.return_value
        response.status = 202
        with patch.dict(os.environ, {"CREDENTIALS_DIRECTORY": str(self.state)}), patch.object(ops.urllib.request, "build_opener", return_value=opener):
            self.assertEqual(ops.send_alert({**CONFIG, "alert_email": "owner@example.invalid"}), "sent")
            request = opener.open.call_args.args[0]
            self.assertEqual(request.full_url, "https://api.resend.com/emails")
            self.assertEqual(request.get_header("Authorization"), "Bearer fixture-resend-key")
            self.assertEqual(json.loads(request.data)["to"], ["owner@example.invalid"])
            self.assertNotIn("fixture-resend-key", request.data.decode())
            response.status = 500
            with self.assertRaises(ValueError):
                ops.send_alert({**CONFIG, "alert_email": "owner@example.invalid"})
            self.assertEqual(ops.send_alert(CONFIG), "unconfigured")
        with self.assertRaises(ValueError):
            ops.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.invalid")


if __name__ == "__main__":
    unittest.main()
