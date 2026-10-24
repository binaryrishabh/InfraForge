"""Run the eight escaped review mutations in memory against their regressions.

No source file is modified. A mutation must make its targeted ordinary test fail;
syntax errors and fixture setup failures do not count as detected guards.
"""
import contextlib
import importlib.util
import io
from pathlib import Path
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location("backup_regressions", ROOT / "test_runner.py")
tests = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tests)
SOURCE = (ROOT / "runner.py").read_text()

# The exact edits correspond to the eight escapes documented by the review.
MUTATIONS = {
    "access_key_in_arguments": (
        '"--cli-connect-timeout", "5", "--cli-read-timeout", "60", *args]',
        '"--cli-connect-timeout", "5", "--cli-read-timeout", "60", access, *args]',
        "test_storage_credentials_never_enter_client_arguments"),
    "inherited_child_stderr": (
        "stderr=subprocess.DEVNULL", "stderr=None", "test_command_suppresses_child_output"),
    "accept_any_backup_key": (
        '    if not isinstance(key, str) or not re.fullmatch(\n'
        '            r"backups/(?:daily/\\d{4}-\\d{2}-\\d{2}|weekly/\\d{4}-W\\d{2})(?:-[0-9a-f]{32})?\\.tar", key):\n'
        '        raise ValueError("Object is outside the supported backup keys")\n',
        "", "test_prune_rejects_escaped_keys_before_any_deletion"),
    "ignore_listing_prefix": (
        '                if not key.startswith(prefix):\n'
        '                    raise ValueError("Listing escaped requested backup prefix")\n',
        "", "test_prune_rejects_escaped_keys_before_any_deletion"),
    "unbounded_deletions": (
        '                    if len(candidates) > MAX_PRUNE_OBJECTS:\n'
        '                        raise ValueError("Prune exceeds deletion budget; operator review required")\n',
        "", "test_prune_bounds_pages_and_deletions"),
    "ignore_drill_destination": (
        'if elapsed is None or elapsed > 93600 or receipt.get("storage") != storage_identity(config):',
        'if elapsed is None or elapsed > 93600:',
        "test_old_target_receipt_cannot_report_health_or_start_restore"),
    "skip_pre_delivery_persistence": (
        '            write_json(STATE / "ops-status.json", state)\n            try:',
        '            try:', "test_monitor_persists_failure_before_interrupted_delivery"),
}


class ReviewMutationTests(unittest.TestCase):
    def check_mutation(self, name):
        if name == "remove_systemd_hooks":
            source = SOURCE
            method = "test_backup_service_wires_both_failure_hooks"
        else:
            old, new, method = MUTATIONS[name]
            self.assertEqual(SOURCE.count(old), 1, "Mutation target changed; review the mutation")
            source = SOURCE.replace(old, new, 1)
        mutated = types.ModuleType("mutated_ops")
        mutated.__file__ = str(ROOT / "runner.py")
        exec(compile(source, mutated.__file__, "exec"), mutated.__dict__)
        original_read = Path.read_text

        def unit_without_hooks(path, *args, **kwargs):
            text = original_read(path, *args, **kwargs)
            if path.name == "infraforge-backup.service":
                text = "\n".join(line for line in text.splitlines()
                                 if not line.startswith(("ExecStartPre=", "ExecStopPost=")))
            return text

        output = io.StringIO()
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(tests, "ops", mutated))
            stack.enter_context(contextlib.redirect_stderr(output))
            if name == "remove_systemd_hooks":
                stack.enter_context(patch.object(Path, "read_text", unit_without_hooks))
            result = unittest.TestResult()
            tests.OperationsTests(method).run(result)
        self.assertEqual(result.testsRun, 1)
        self.assertEqual(result.errors, [], "An unrelated fixture error is not a detected guard")
        self.assertTrue(result.failures, f"Escaped review mutation: {name}")


def mutation_test(name):
    def check(self):
        self.check_mutation(name)
    return check


for name in [*MUTATIONS, "remove_systemd_hooks"]:
    setattr(ReviewMutationTests, "test_" + name, mutation_test(name))


if __name__ == "__main__":
    unittest.main()
