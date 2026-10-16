import { expect, test } from "bun:test";
import { evaluate, required } from "./policy";
import type { Snapshot } from "./policy";
import { command } from "./command";
import { collect } from "./collect";
import { probeSandbox } from "./probeSandbox";
import { mkdir } from "node:fs/promises";
import { provenance } from "./identity";
import { DockerConnection } from "../../apps/backend/internalModel2/dockerConnection";
const image = `sha256:${"a".repeat(64)}`, revision = "b".repeat(40);
// Synthetic observations exercise policy only. They are never actual-host proof.
const fixture = (): Snapshot => ({ platform: "linux", uid: 1001, kernel: "unit-fixture", arch: "x64",
  socket: { owner: 1001, runtimeOwner: 1001, mode: 0o660, runtimeMode: 0o700, canonical: true, isSocket: true },
  endpoint: { matches: true, isolatedConfig: true, rootfulAccessible: false },
  daemon: { rootless: true, cgroupVersion: "2", driver: "systemd", version: "unit-fixture", kernel: "unit-fixture", logging: "local" },
  owner: { uid: 1001, namespaceSeparated: true, serviceMember: true }, service: { active: "active", delegate: "yes", controllers: ["cpu", "memory", "pids"] },
  image: { id: image, revision, source: "https://github.com/binaryrishabh/InfraForge", volumes: false },
  capacity: { memoryAvailable: 2147483648, diskAvailable: 2147483648, localDisk: true }, containers: 0, logs: { bounded: true, driver: "local" } });
test("complete observations permit probes but never claim rootless readiness", () => {
  const result = evaluate(fixture(), image, revision);
  expect(result.eligibleForProbes).toBe(true); expect(result.rootlessReady).toBe(false);
  for (const id of required) expect(result.checks[id]!.status).toBe("VERIFIED");
  for (const id of ["resourceEnforcement", "lifecycle", "controlAuthority", "disableRecovery", "capacityOverTime", "runtimeConnectionStability"]) expect(result.checks[id]!.status).toBe("UNKNOWN");
  expect(result.checks.boundedLogs!.basis).toBe("configured");
});
const failures: Record<string, (s: Snapshot) => void> = {
  "rootful daemon": (s) => { s.daemon!.rootless = false; },
  "cgroup v1": (s) => { s.daemon!.cgroupVersion = "1"; },
  "missing systemd driver": (s) => { s.daemon!.driver = "none"; },
  "missing CPU delegation": (s) => { s.service!.controllers = ["memory", "pids"]; },
  "missing memory delegation": (s) => { s.service!.controllers = ["cpu", "pids"]; },
  "missing PID delegation": (s) => { s.service!.controllers = ["cpu", "memory"]; },
  "wrong socket owner": (s) => { s.socket!.owner = 0; },
  "socket symlink": (s) => { s.socket!.canonical = false; },
  "public runtime directory": (s) => { s.socket!.runtimeMode = 0o755; },
  "world accessible socket": (s) => { s.socket!.mode = 0o666; },
  "context mismatch": (s) => { s.endpoint!.matches = false; },
  "ambient client configuration": (s) => { s.endpoint!.isolatedConfig = false; },
  "rootful daemon access": (s) => { s.endpoint!.rootfulAccessible = true; },
  "wrong daemon owner": (s) => { s.owner!.uid = 0; },
  "same daemon namespace": (s) => { s.owner!.namespaceSeparated = false; },
  "unmanaged daemon": (s) => { s.owner!.serviceMember = false; },
  "inactive service": (s) => { s.service!.active = "inactive"; },
  "undelegated service": (s) => { s.service!.delegate = "no"; },
  "remote kernel mismatch": (s) => { s.daemon!.kernel = "another-kernel"; },
  "unpinned image": (s) => { s.image!.id = "latest"; },
  "wrong image revision": (s) => { s.image!.revision = "c".repeat(40); },
  "implicit image volumes": (s) => { s.image!.volumes = true; },
  "untrusted image source": (s) => { s.image!.source = "untrusted"; },
  "low memory": (s) => { s.capacity!.memoryAvailable = 1073741824; },
  "low disk": (s) => { s.capacity!.diskAvailable = 0; },
  "NFS data root": (s) => { s.capacity!.localDisk = false; },
  "other daemon workloads": (s) => { s.containers = 1; },
  "unbounded logs": (s) => { s.logs!.bounded = false; },
};
for (const [name, change] of Object.entries(failures)) test(`preflight refuses ${name}`, () => {
  const s = fixture(); change(s); const result = evaluate(s, image, revision);
  expect(result.eligibleForProbes).toBe(false); expect(result.rootlessReady).toBe(false);
  expect(Object.values(result.checks).some((v) => v.status === "FAILED")).toBe(true);
});
test("incomplete observations remain Unknown and cannot authorize probes", () => {
  const result = evaluate({ platform: "linux", uid: 1001 }, image, revision);
  expect(result.checks.rootless!.status).toBe("UNKNOWN"); expect(result.checks.image!.status).toBe("UNKNOWN"); expect(result.eligibleForProbes).toBe(false);
});
test("non-Linux and root users are explicitly refused", () => {
  for (const s of [{ platform: "win32" }, { platform: "linux", uid: 0 }]) expect(evaluate(s, image, revision).checks.linuxUser!.status).toBe("FAILED");
});
test("bounded commands reject failure and excess output", async () => {
  await expect(command(process.execPath, ["-e", "process.exit(1)"])).rejects.toThrow("Inspection unavailable");
  await expect(command(process.execPath, ["-e", "process.stdout.write('x'.repeat(1100000))"])).rejects.toThrow("Inspection unavailable");
});
test.skipIf(!process.env.LESSON_HOST_CI_REFUSAL)("actual disposable rootful CI is never host readiness", async () => {
  const info = JSON.parse(await DockerConnection.use((c) => c.run(["info", "--format", "{{json .}}"], 1048576)));
  expect(info.SecurityOptions.includes("name=rootless")).toBe(false);
  const result = evaluate(await collect(process.env.MODEL2_LESSON_IMAGE!), process.env.MODEL2_LESSON_IMAGE!, process.env.GITHUB_SHA!);
  expect(result.eligibleForProbes).toBe(false); expect(result.rootlessReady).toBe(false); expect(result.checks.rootless!.status).not.toBe("VERIFIED");
  await mkdir("/tmp/infraforge-m2m", { recursive: true });
  await Bun.write("/tmp/infraforge-m2m/rootful-host-refusal.json", JSON.stringify({ ...result, provenance: provenance() }, null, 2));
  const output = "/tmp/infraforge-m2m/bounded-host-fixtures"; await mkdir(output);
  const probes = await probeSandbox(process.env.MODEL2_LESSON_IMAGE!, output);
  await Bun.write(`${output}/disposable-proof.json`, JSON.stringify({ environment: "disposable-rootful-CI", actualHost: "UNVERIFIED", rootlessReady: false, provenance: provenance(), probes }));
}, 180000);
