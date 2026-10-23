import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const unit = readFileSync("ops/first-stack-verifier.service", "utf8");
function values(key: string) {
  return unit.split(/\r?\n/).filter(line => line.startsWith(`${key}=`)).map(line => line.slice(key.length + 1));
}

test("verifier sandbox exposes only the provisioned rootless socket through hidden homes", () => {
  expect(values("ProtectHome")).toEqual(["tmpfs"]);
  expect(values("BindReadOnlyPaths")).toEqual(["/run/user/REPLACE_WITH_UID/docker.sock"]);
  expect(values("BindPaths")).toEqual([]);
  expect(unit.replaceAll("REPLACE_WITH_UID", "1234")).toContain(
    "BindReadOnlyPaths=/run/user/1234/docker.sock");
  expect(values("User")).toEqual(["infraforge-verifier"]);
  expect(values("ProtectSystem")).toEqual(["strict"]);
});

test("systemd lets the supervisor drain children before the final cgroup kill", () => {
  expect(values("KillMode")).toEqual(["mixed"]);
  expect(values("TimeoutStopSec")).toEqual(["735"]);
  expect(values("SendSIGKILL")).not.toContain("no");
  expect(values("KillSignal")).toEqual([]); // Default SIGTERM reaches the main process only.
  expect(unit).not.toContain("[Install]");
});
