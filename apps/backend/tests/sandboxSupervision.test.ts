import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { boundProcess } from "../internalModel2/dockerConnection";
import { runSandbox } from "../internalModel2/sandboxRunner";
import { LESSON_SANDBOX as limits } from "../internalModel2/lessonLimits";
import { executionSource } from "../internalModel2/identity";

// Simulated attachment events test supervision, never actual kernel enforcement.
function fixture() {
  const id = "12345678-1234-1234-1234-123456789abc", name = `infraforge-model2-${id}`, image = `sha256:${"a".repeat(64)}`;
  const child: any = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let killed = false, removed = false, attached!: () => void;
  const ready = new Promise<void>(resolve => { attached = resolve; });
  child.kill = () => { killed = true; return true; };
  const value = { Id: "b".repeat(64), Image: image, Name: `/${name}`, Config: { User: "1000:1000", Labels: { "infraforge.model2": name } }, Mounts: [],
    State: { Running: true, ExitCode: 0, OOMKilled: false, Error: "" },
    HostConfig: { Memory: limits.memoryBytes, MemorySwap: limits.memoryBytes, NanoCpus: limits.nanoCpus, PidsLimit: limits.pids, NetworkMode: "none", ReadonlyRootfs: true, Init: true, Privileged: false, Binds: [], CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges=true"],
      Ulimits: [{ Name: "nofile", Soft: limits.nofile, Hard: limits.nofile }, { Name: "cpu", Soft: limits.cpuSeconds, Hard: limits.cpuSeconds }, { Name: "core", Soft: 0, Hard: 0 }] } };
  const control: any = { receipt: {}, assertSocket: async () => {},
    run: async (args: string[]) => {
      if (args[0] === "ps") return "";
      if (args[0] === "create") return value.Id;
      if (args[0] === "inspect") return JSON.stringify([value]);
      if (args[0] === "rm") { removed = true; return ""; }
      throw Error("Unexpected command");
    }, attach: async () => { attached(); return child; } };
  const release = () => { child.stdout.end(); child.stderr.end(); child.emit("close", 137); };
  return { id, image, child, control, ready, value, release, get killed() { return killed; }, get removed() { return removed; } };
}

test("ownership cancellation settles without an attachment close event", async () => {
  const f = fixture(), controller = new AbortController();
  const pending = runSandbox(f.control, f.id, f.image, {}, async () => {}, async () => {}, controller.signal);
  void pending.catch(() => {});
  try {
    await f.ready; await Bun.sleep(10); controller.abort();
    await expect(pending).rejects.toThrow("ownership lost");
    expect(f.killed).toBe(true); expect(f.removed).toBe(true);
  } finally { f.release(); await pending.catch(() => {}); }
}, 2000);

test("command deadline rejects even when killing the client produces no events", async () => {
  const f = fixture();
  await expect(boundProcess(f.child, () => new Promise(() => {}), 20, "control deadline")).rejects.toThrow("control deadline");
  expect(f.killed).toBe(true); expect(f.child.stdout.destroyed).toBe(true);
}, 2000);

test("verified failed-container state survives missing attachment EOF and close", async () => {
  const f = fixture(); let receipt: any;
  const pending = runSandbox(f.control, f.id, f.image, {}, async () => {}, async value => { receipt = structuredClone(value); });
  void pending.catch(() => {});
  try {
    await f.ready; f.value.State = { Running: false, ExitCode: 137, OOMKilled: true, Error: "" };
    await expect(pending).rejects.toThrow("exit 137, OOM true");
    expect(receipt.exit).toEqual({ code: 137, oom: true, error: "" }); expect(f.removed).toBe(true);
  } finally { f.release(); await pending.catch(() => {}); }
}, 2000);

test("zero container exit cannot replace a missing completion protocol", async () => {
  const f = fixture(), controller = new AbortController(); let receipt: any;
  const pending = runSandbox(f.control, f.id, f.image, {}, async () => {}, async value => { receipt = structuredClone(value); }, controller.signal);
  void pending.catch(() => {});
  try {
    await f.ready; f.value.State.Running = false; await Bun.sleep(550); controller.abort();
    await expect(pending).rejects.toThrow("ownership lost"); expect(receipt.exit).toBeUndefined();
  } finally { f.release(); await pending.catch(() => {}); }
}, 2000);

test("successful execution still requires ready, complete output and actual attachment exit", async () => {
  const f = fixture();
  const pending = runSandbox(f.control, f.id, f.image, {}, async () => {}, async () => {});
  await f.ready; await Bun.sleep(10);
  f.child.stdout.write(JSON.stringify({ kind: "ready", source: executionSource, enforcement: { memory: String(limits.memoryBytes), swap: "0", pids: String(limits.pids), uid: 1000, cpu: "100000 100000", limits: "Max cpu time 5 5 seconds\nMax open files 128 128", env: [] } }) + "\n");
  f.child.stdout.end(JSON.stringify({ kind: "done" }) + "\n"); f.child.stderr.end();
  f.value.State.Running = false; f.child.emit("close", 0);
  const receipt = await pending;
  expect(receipt.exit).toEqual({ code: 0, oom: false, error: "" }); expect(f.removed).toBe(true);
}, 2000);
