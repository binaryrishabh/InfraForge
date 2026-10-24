import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { prepareFirstStackExecution, instantiatePreparedFirstStack } from "../firstStack/execution";
import { captureExecutionCut } from "../firstStack/executionCut";
import { inputDigest, isolatedCut } from "../firstStack/isolationProtocol";
import { FIRST_STACK_ISOLATION as limits } from "../firstStack/isolationPolicy";

// Real engine + protocol fixture, deliberately no host/containment measurement.
export function fixtureCut(input: string, source: string) {
  const saved = JSON.parse(input);
  const prepared = prepareFirstStackExecution(saved.owner, saved.layout, saved.candidate,
    saved.recording, saved.policy);
  const runtime = instantiatePreparedFirstStack(prepared); runtime.advanceTo(runtime.horizon);
  return isolatedCut(captureExecutionCut(prepared, runtime, 1, { wallMs: 60000, cpuUs: 20000000,
    rssBytes: 536870912, frameBytes: 1048576, summaryBytes: 10485760, captureBytes: 33554432 }, null).value,
  source, inputDigest(input));
}
export function verifierProtocolFixture(engine: { image: string; source: string }, beforeCut: () => Promise<void>) {
  let launches = 0, removed = 0;
  const value: any = { Id: "d".repeat(64), Image: engine.image, Name: "/infraforge-first-stack-executor",
    Config: { User: "1000:1000", Labels: {}, Env: ["HOME=/tmp"],
      Entrypoint: ["timeout"], WorkingDir: "/app/apps/backend" }, Mounts: [],
    State: { Running: false, ExitCode: 0, OOMKilled: false }, HostConfig: {
      Memory: limits.memoryBytes, MemorySwap: limits.memoryBytes, NanoCpus: limits.nanoCpus, PidsLimit: limits.pids,
      NetworkMode: "none", CgroupnsMode: "private", ReadonlyRootfs: true, Init: true, CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges=true"], LogConfig: { Type: "none" },
      Tmpfs: { "/tmp": `rw,noexec,nosuid,nodev,size=${limits.tmpBytes}` },
      Ulimits: [{ Name: "nofile", Soft: 128, Hard: 128 }, { Name: "cpu", Soft: 20, Hard: 20 },
        { Name: "core", Soft: 0, Hard: 0 }],
    } };
  const control: any = { identity: "c".repeat(64), assertIdentity: async () => {},
    run: async (args: string[]) => {
      if (args[0] === "create") {
        launches++; value.State.Running = true;
        value.Config.Labels["infraforge.first-stack"] = args[args.indexOf("--label") + 1]!.split("=")[1];
        value.Config.Cmd = args.slice(-7); return value.Id;
      }
      if (args[0] === "inspect") return JSON.stringify([value]);
      if (args[0] === "rm") { removed++; value.State.Running = false; return ""; }
      throw Error("Unexpected fixture command");
    },
    attach: async () => {
      const child: any = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      let ended = false, buffer = "", line = 0;
      const end = () => { if (ended) return; ended = true; value.State.Running = false;
        child.stdout.end(); child.stderr.end(); child.emit("close", 0); };
      child.kill = () => { end(); return true; };
      const send = (frame: unknown) => child.stdout.write(JSON.stringify(frame) + "\n");
      child.stdin.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        while (buffer.includes("\n")) {
          const at = buffer.indexOf("\n"), text = buffer.slice(0, at); buffer = buffer.slice(at + 1); line++;
          if (line === 2) void beforeCut().then(() => {
            if (!ended) send({ kind: "cut", value: fixtureCut(text, engine.source) });
          });
          if (line === 3) {
            send({ kind: "artifact", artifact: "summary", index: 0, text: "{}" });
            send({ kind: "result", status: "completed", interruption: null }); send({ kind: "done" });
            setTimeout(end, 0);
          }
        }
      });
      setTimeout(() => send({ kind: "ready", source: engine.source, enforcement: {
        memory: String(limits.memoryBytes), swap: "0", pids: "64", uid: 1000, gid: 1000, cpu: "50000 100000",
        limits: "Max cpu time 20 20 seconds\nMax open files 128 128",
        status: "NoNewPrivs:\t1\nCapEff:\t0000000000000000\n",
      } }), 0);
      return child;
    } };
  return { control, get launches() { return launches; }, get removed() { return removed; } };
}
