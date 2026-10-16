import { LESSON_SANDBOX as limits } from "./lessonLimits";
import { executionSource } from "./identity";
import { containerName, createArguments, verifyContainer, inspectContainer, removeContainer } from "./sandboxDocker";
import type { DockerConnection } from "./dockerConnection";
export interface SandboxReceipt { schema: "model2-sandbox-receipt/1"; connection?: DockerConnection["receipt"]; inspection: ReturnType<typeof verifyContainer>; enforcement?: unknown; exit?: { code: number; oom: boolean; error: string }; elapsedMs?: number; errorOutput?: string }
export async function runSandbox(control: DockerConnection, id: string, image: string, input: unknown, onFrame: (value: any) => Promise<unknown>, onReceipt: (receipt: SandboxReceipt) => Promise<void>, signal?: AbortSignal, origin = id) {
  const name = containerName(id), started = Date.now(), serialized = JSON.stringify(input) + "\n";
  if (Buffer.byteLength(serialized) > limits.inputBytes) throw Error("Sandbox input budget exceeded");
  let child: Awaited<ReturnType<DockerConnection["attach"]>> | undefined, deadline: ReturnType<typeof setTimeout> | undefined, failure: Error | undefined;
  const abort = () => { failure ??= Error("Isolated runner ownership lost"); child?.kill("SIGKILL"); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    // The database lease cannot outlive a killed parent. Refuse overlap with its
    // still-running container until the independent inner deadline has stopped it.
    if (await control.run(["ps", "--filter", "label=infraforge.model2", "--filter", "status=running", "--format", "{{.ID}}"])) throw Error("An isolated executor is still active; no second executor started");
    const container = await control.run(createArguments(name, image, origin));
    if (!/^[a-f0-9]{64}$/.test(container)) throw Error("Invalid created container identity");
    const inspection = verifyContainer(await inspectContainer(control, container), name, image), receipt: SandboxReceipt = { schema: "model2-sandbox-receipt/1", connection: control.receipt, inspection };
    await onReceipt(receipt);
    signal?.throwIfAborted();
    child = await control.attach(container);
    const running = child;
    const kill = (reason: string) => { failure ??= Error(reason); running.kill("SIGKILL"); };
    const exited = new Promise<number | null>((resolve, reject) => { running.once("error", reject); running.once("close", resolve); });
    // Observe rejection immediately, even while awaiting stream data or a commit.
    void exited.catch(() => {});
    deadline = setTimeout(() => kill("Sandbox wall deadline exceeded"), Math.max(1, limits.deadlineMs - (Date.now() - started)));
    let stderr = 0, errorOutput = "";
    running.stderr.on("data", (chunk: Buffer) => { stderr += chunk.length; errorOutput = (errorOutput + chunk.toString("utf8")).slice(0, 2048); if (stderr > 16384) kill("Sandbox error output budget exceeded"); });
    running.stdin.on("error", () => { /* Exit/pipe closure is assessed below. */ });
    running.stdin.write(serialized);
    let pending = Buffer.alloc(0), bytes = 0, frames = 0, ready = false, done = false, stopped = false;
    for await (const chunk of running.stdout) {
      bytes += chunk.length;
      if (bytes > limits.outputBytes) throw Error("Sandbox output budget exceeded");
      pending = Buffer.concat([pending, chunk]);
      let end: number;
      while ((end = pending.indexOf(10)) !== -1) {
        if (end > limits.lineBytes || ++frames > 35) throw Error("Sandbox frame budget exceeded");
        const frame = JSON.parse(pending.subarray(0, end).toString("utf8")); pending = pending.subarray(end + 1);
        if (done || stopped) throw Error("Unexpected output after terminal frame");
        if (!ready) {
          const e = frame.enforcement, cpu = String(e?.cpu).split(/\s+/).map(Number);
          if (frame.kind !== "ready" || frame.source !== executionSource || e.memory !== String(limits.memoryBytes) || e.swap !== "0" || e.pids !== String(limits.pids) || e.uid !== 1000 || cpu.length !== 2 || cpu[0] !== cpu[1] ||
            !/Max cpu time\s+5\s+5\s+seconds/.test(e.limits) || !/Max open files\s+128\s+128/.test(e.limits) || e.env.some((key: string) => /DATABASE|REDIS|SECRET|TOKEN|AUTH/.test(key))) throw Error("Kernel containment verification failed");
          receipt.enforcement = e; await onReceipt(receipt); ready = true;
        } else if (frame.kind === "done") done = true;
        else {
          await control.assertSocket();
          const ack = await onFrame(frame);
          if (ack !== undefined) { running.stdin.write(JSON.stringify(ack) + "\n"); if ((ack as { continue: boolean }).continue === false) stopped = true; }
        }
      }
      if (pending.length > limits.lineBytes) throw Error("Sandbox line budget exceeded");
    }
    const code = await exited;
    if (failure) throw failure;
    const state = (await inspectContainer(control, container)).State;
    receipt.exit = { code: state.ExitCode, oom: state.OOMKilled, error: String(state.Error).slice(0, 500) }; receipt.elapsedMs = Date.now() - started;
    if (errorOutput) receipt.errorOutput = errorOutput;
    await onReceipt(receipt);
    if (code !== 0 || state.ExitCode !== 0 || state.OOMKilled || pending.length || !ready || !done && !stopped) throw Error(`Sandbox ended without a complete protocol (exit ${state.ExitCode}, OOM ${Boolean(state.OOMKilled)})`);
    return receipt;
  } finally {
    clearTimeout(deadline); child?.kill("SIGKILL");
    signal?.removeEventListener("abort", abort);
    await removeContainer(control, name, image);
  }
}
