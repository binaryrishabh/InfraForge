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
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("ops_runner", Path(__file__).with_name("runner.py"))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)
CONFIG = {"region": "us-east-1", "bucket": "fixture-backups", "instance_id": "i-0123456789abcdef0",
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
        patch.object(socket, "socket", side_effect=AssertionError("Network forbidden in offline tests")).start()
        self.calls = []

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

    def test_daily_and_weekly_put_only_encrypted_checked_bundle(self):
        import tarfile
        original = self.fake_command
        def check(args, **kwargs):
            if args[0] == "aws":
                self.assertIn("put-object", args)
                self.assertEqual(args[args.index("--server-side-encryption") + 1], "AES256")
                self.assertEqual(args[args.index("--checksum-algorithm") + 1], "SHA256")
                with tarfile.open(args[args.index("--body") + 1]) as tar:
                    self.assertEqual(tar.getnames(), ["archive.dump", "SHA256SUMS"])
                self.assertNotIn("PGPASSWORD", kwargs["env"])
            return original(args, **kwargs)
        with patch.object(ops, "command", check), patch.dict(os.environ, {"BACKUP_DATABASE_URL": URL}, clear=True):
            ops.backup(CONFIG, NOW)
        uploads = [args for args, _, _ in self.calls if args[0] == "aws"]
        self.assertEqual([args[args.index("--key") + 1] for args in uploads],
                         ["backups/daily/2026-10-20.tar", "backups/weekly/2026-W43.tar"])
        self.assertEqual(ops.read_json(self.state / "backup.json")["snapshot_at"], NOW)
        self.assertFalse((self.state / "backups/backup.fixture/backup.tar").exists())

    def test_existing_week_only_uploads_daily_and_removes_old_local_copy(self):
        self.archive("backup.old")
        ops.write_json(self.state / "backup.json", {"archive": "backup.old", "week": "2026-W43"})
        self.backup()
        self.assertEqual(sum(args[0] == "aws" for args, _, _ in self.calls), 1)
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
        with patch.object(ops, "MAX_OBJECT_BYTES", 1), patch.object(ops, "aws") as aws:
            with self.assertRaises(ValueError):
                ops.upload(CONFIG, archive / "archive.dump", "backups/daily/fixture.tar")
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
        ops.write_json(self.state / "backup.json", {"snapshot_at": NOW - 60, "archive": archive.name})
        with patch.object(ops.time, "time", return_value=NOW), patch.object(ops, "command", self.fake_command), patch.dict(os.environ, {"PGPASSWORD": "synthetic", "BACKUP_DATABASE_URL": URL}):
            ops.drill(CONFIG)
        self.assertTrue(ops.read_json(self.state / "drill.json")["ok"])
        self.assertTrue(any(args[0] == "bash" and args[1].endswith("prove-backup.sh") for args, _, _ in self.calls))
        self.assertTrue(any("/restore/verify.sh" in args and "local-only" in " ".join(args) for args, _, _ in self.calls))
        run = next(args for args, _, _ in self.calls if args[:2] == ["docker", "run"])
        self.assertEqual(run[run.index("--network") + 1], "none")
        self.assertFalse((self.state / "drill-container.json").exists())
        for _, env, _ in self.calls:
            self.assertNotIn("PGPASSWORD", env)
            self.assertNotIn("BACKUP_DATABASE_URL", env)

    def test_restore_failure_cleans_container_and_latches_failure(self):
        archive = self.archive()
        ops.write_json(self.state / "backup.json", {"snapshot_at": NOW - 60, "archive": archive.name})
        def fail_restore(args, **kwargs):
            self.fake_command(args, **kwargs)
            if "/restore/verify.sh" in args:
                raise subprocess.CalledProcessError(1, "mock-restore")
            return b""
        with patch.object(ops.time, "time", return_value=NOW), patch.object(ops, "command", fail_restore):
            with self.assertRaises(subprocess.CalledProcessError):
                ops.drill(CONFIG)
        self.assertEqual(ops.read_json(self.state / "drill.json"), {"ok": False})
        self.assertTrue(any(args[:3] == ["docker", "rm", "-fv"] for args, _, _ in self.calls))

    def test_stale_restore_source_never_starts_docker(self):
        ops.write_json(self.state / "backup.json", {"snapshot_at": NOW - 93601, "archive": "backup.fixture"})
        with patch.object(ops.time, "time", return_value=NOW), patch.object(ops, "command") as command:
            with self.assertRaises(ValueError):
                ops.drill(CONFIG)
            command.assert_not_called()

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


if __name__ == "__main__":
    unittest.main()
