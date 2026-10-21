import { randomUUID } from "node:crypto";
import { boundProcess } from "../internalModel2/dockerConnection";
import { activeEntrypoint } from "../executionIdentity/launch";
import type { IsolationControl } from "./isolationConnection";
import { firstStackContainerArguments, verifyFirstStackContainer, verifyFirstStackReady } from "./isolationContainer";
import { FIRST_STACK_ISOLATION as limits, assertQualified, executorName, type HostQualification } from "./isolationPolicy";
import { boundedLines, inputDigest, readIsolatedCut, type IsolatedCut } from "./isolationProtocol";

export interface IsolationRequest {
  mode: "execute" | "replay"; input: string; expected?: IsolatedCut;
}
export interface IsolationAuthority {
  // Owned submission stores persist this before create so recovery can match
  // an orphan's Docker label to its durable work row. Offline probes omit it.
  token?: string;
  // Must recheck the captured owner, authorization, cancellation and DB fencing.
  // Unknown/unavailable is rejection. Called before launch, on a timer and at
  // every ACK; a replay uses the same authority and capacity as execution.
  assertHeld(signal: AbortSignal): Promise<void>;
  // Resolve only after atomic commit under that same fence. The store must not
  // publish a late transaction after signal/ownership loss. Never auto-retry.
  commit(cut: IsolatedCut, signal: AbortSignal): Promise<void>;
}
export interface IsolationConfiguration { image: string; source: string; qualification: HostQualification | null }
export interface IsolationReceipt {
  schema: "first-stack-isolation-receipt/1"; daemon: string; image: string;
  container: string | null; enforcement: unknown; elapsedMs: number;
  exit: { code: number; oom: boolean } | null; outputBytes: number;
  cleanup: "not-created" | "unconfirmed" | "removed" | "failed";
}
export async function runFirstStackContainer(control: IsolationControl, configuration: IsolationConfiguration,
  request: IsolationRequest, authority: IsolationAuthority, signal?: AbortSignal) {
  if (!["execute", "replay"].includes(request.mode)) throw Error("Invalid product execution mode");
  assertQualified(configuration.qualification, { ...configuration, daemon: control.identity });
  return contained(control, configuration, request, authority, signal);
}
// An operator-only measurement entrypoint, not an execution-readiness override.
// Verification is serial, including operator characterization.
export function probeFirstStackContainer(control: IsolationControl, configuration: Omit<IsolationConfiguration, "qualification">,
  request: IsolationRequest | { mode: "probe"; input: string; expected?: never }, authority: IsolationAuthority, signal?: AbortSignal) {
  if (activeEntrypoint() !== "scripts/first-stack-host/qualify.ts") throw Error("Host probes require the explicit offline qualification command");
  return contained(control, configuration, request, authority, signal);
}
async function contained(control: IsolationControl, configuration: Omit<IsolationConfiguration, "qualification">,
  request: IsolationRequest | { mode: "probe"; input: string; expected?: never }, authority: IsolationAuthority, signal?: AbortSignal, name = executorName) {
  const inputHash = inputDigest(request.input);
  if (request.mode === "replay") {
    if (!request.expected) throw Error("Replay requires the original durable prefix");
    readIsolatedCut(request.expected, configuration.source, inputHash);
  } else if (!["execute", "probe"].includes(request.mode) || request.expected) throw Error("Invalid isolated request");
  const start = Date.now(), token = authority.token ?? randomUUID(), abort = new AbortController();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(token)) throw Error("Invalid captured executor token");
  const receipt: IsolationReceipt = { schema: "first-stack-isolation-receipt/1", daemon: control.identity,
    image: configuration.image, container: null, enforcement: null, elapsedMs: 0, exit: null, outputBytes: 0, cleanup: "not-created" };
  let child: Awaited<ReturnType<IsolationControl["attach"]>> | undefined, timer: ReturnType<typeof setInterval> | undefined;
  let durable: IsolatedCut | null = null, summary: string | null = null, journal: string | null = null, replay: any = null, probe: any = null;
  let failure: string | null = null, result: { status: string; interruption: unknown } | null = null;
  const stop = () => abort.abort(signal?.reason ?? Error("Execution cancelled"));
  signal?.addEventListener("abort", stop, { once: true });
  const deadline = setTimeout(() => abort.abort(Error("Executor supervisor wall deadline exceeded")), limits.supervisorMs);
  // Covers create/inspect and authority promises as well as pipe reads. A late
  // create remains under the reserved fixed name; it cannot start a replacement.
  const interrupted = new Promise<never>((_yes, no) => {
    abort.signal.addEventListener("abort", () => no(abort.signal.reason), { once: true });
  });
  void interrupted.catch(() => {});
  const bounded = <T>(task: Promise<T>) => Promise.race([task, interrupted]);
  const inspect = async () => JSON.parse(await control.run(["inspect", receipt.container!]))[0];
  try {
    if (signal?.aborted) stop();
    abort.signal.throwIfAborted();
    await bounded(authority.assertHeld(abort.signal));
    await bounded(control.assertIdentity());
    // Docker's name reservation is atomic across independent worker/API
    // processes. Never use a ps-then-create check, a random fallback, --rm, or
    // cleanup-by-name after a create conflict.
    receipt.cleanup = "unconfirmed";
    const id = await bounded(control.run(firstStackContainerArguments(configuration.image, token, name)));
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Invalid created executor identity");
    receipt.container = id;
    verifyFirstStackContainer(await bounded(inspect()), configuration.image, token, name);
    await bounded(authority.assertHeld(abort.signal));
    child = await bounded(control.attach(id));
    const running = child;
    await boundProcess(running, async () => {
      const exited = new Promise<number | null>((yes, no) => { running.once("error", no); running.once("close", yes); });
      void exited.catch(() => {});
      let checking = false;
      timer = setInterval(() => {
        if (checking || abort.signal.aborted) return;
        checking = true;
        void bounded((async () => {
          await authority.assertHeld(abort.signal);
          const state = (await inspect()).State;
          if (typeof state?.Running !== "boolean" || typeof state.OOMKilled !== "boolean" || !Number.isInteger(state.ExitCode)) throw Error("Executor state Unknown");
          if (!state.Running && state.ExitCode !== 0) {
            receipt.exit = { code: state.ExitCode, oom: state.OOMKilled };
            throw Error("Executor terminated before a complete protocol");
          }
        })()).catch(error => abort.abort(error)).finally(() => { checking = false; });
      }, 500);
      let errors = 0;
      running.stderr.on("data", (chunk: Buffer) => { errors += chunk.length; if (errors > limits.errorBytes) abort.abort(Error("Executor stderr budget exceeded")); });
      running.stdin.on("error", () => { /* Exit and bounded protocol decide success. */ });
      const write = (text: string) => new Promise<void>((yes, no) => running.stdin.write(text, error => error ? no(error) : yes()));
      let ready = false, done = false, sequence = 0;
      const artifacts = { summary: [] as string[], journal: [] as string[] };
      for await (const text of boundedLines(running.stdout, limits.lineBytes, limits.outputBytes)) {
        receipt.outputBytes += Buffer.byteLength(text) + 1;
        abort.signal.throwIfAborted();
        const frame = JSON.parse(text);
        if (done) throw Error("Output after terminal frame");
        if (!ready) {
          verifyFirstStackReady(frame, configuration.source);
          receipt.enforcement = frame.enforcement;
          await bounded(authority.assertHeld(abort.signal));
          ready = true;
          await bounded(write(JSON.stringify({ mode: request.mode, inputHash, source: configuration.source, ...(request.expected ? { expected: request.expected } : {}) }) + "\n"));
          await bounded(write(request.input + "\n"));
        } else if (frame.kind === "cut" && request.mode === "execute" && !result) {
          const value = readIsolatedCut(frame.value, configuration.source, inputHash, durable ?? undefined);
          if (value.cut.sequence !== ++sequence) throw Error("Executor cut sequence gap");
          await bounded(authority.assertHeld(abort.signal));
          await bounded(authority.commit(value, abort.signal));
          // Record the committed value before a subsequent authorization failure.
          durable = value;
          await bounded(authority.assertHeld(abort.signal));
          abort.signal.throwIfAborted();
          await bounded(write(JSON.stringify({ kind: "ack", sequence, fingerprint: value.fingerprint, continue: true }) + "\n"));
        } else if (frame.kind === "artifact" && request.mode === "execute" && !result) {
          if (!["summary", "journal"].includes(frame.artifact) || typeof frame.text !== "string") throw Error("Invalid artifact frame");
          const rows = artifacts[frame.artifact as "summary" | "journal"];
          if (frame.index !== rows.length) throw Error("Artifact chunk sequence gap");
          rows.push(frame.text);
        } else if (frame.kind === "result" && request.mode === "execute" && !result && ["completed", "interrupted"].includes(frame.status)) {
          result = frame;
        } else if (frame.kind === "replay" && request.mode === "replay" && replay === null &&
          ["MatchesRecordedPrefix", "Mismatch"].includes(frame.value?.kind) &&
          frame.value.inputHash === inputHash && frame.value.expected === request.expected?.fingerprint) {
          replay = frame.value;
        } else if (frame.kind === "probe" && request.mode === "probe" && probe === null) {
          probe = frame.value;
        } else if (frame.kind === "done" && (request.mode === "execute" ? result !== null : request.mode === "probe" ? probe !== null : replay !== null)) {
          done = true; running.stdin.end();
        } else throw Error("Unexpected isolated protocol frame");
      }
      const exit = await exited, state = (await inspect()).State;
      receipt.exit = { code: state.ExitCode, oom: state.OOMKilled };
      if (!ready || !done || exit !== 0 || state.Running || state.ExitCode !== 0 || state.OOMKilled) throw Error("Incomplete executor protocol or failed exit");
      await authority.assertHeld(abort.signal);
      abort.signal.throwIfAborted();
      if (request.mode === "execute" && result?.status === "completed") {
        if (!durable?.cut.completeness.horizonReached || !artifacts.summary.length) throw Error("Completed executor lacks a durable horizon/summary");
        summary = artifacts.summary.join(""); journal = artifacts.journal.join("");
      }
    }, Math.max(1, limits.supervisorMs - (Date.now() - start)), "Executor deadline exceeded", abort.signal);
  } catch (error) {
    failure = (error instanceof Error ? error.message : "Executor interrupted").slice(0, 400);
  } finally {
    clearInterval(timer); clearTimeout(deadline); signal?.removeEventListener("abort", stop);
    abort.abort(Error("Executor closed")); child?.kill("SIGKILL");
    if (receipt.container) {
      try {
        const value = await inspect();
        if (value.Id !== receipt.container || value.Config?.Labels?.["infraforge.first-stack"] !== token || value.Image !== configuration.image) throw Error("Cleanup ownership mismatch");
        receipt.exit ??= value.State?.Running ? null : { code: value.State.ExitCode, oom: value.State.OOMKilled };
        await control.run(["rm", "--force", receipt.container]);
        receipt.cleanup = "removed";
      } catch { receipt.cleanup = "failed"; failure ??= "Executor cleanup failed; capacity remains reserved until operator recovery"; }
    }
    receipt.elapsedMs = Date.now() - start;
  }
  if (failure) { summary = null; journal = null; replay = null; }
  const terminal = result as { status: string; interruption: unknown } | null;
  return { status: failure || terminal?.status === "interrupted" ? "interrupted" as const : "completed" as const,
    interruption: (failure ? { classification: "executor-interrupted", reason: failure } : terminal?.interruption ?? null) as { classification: "executor-interrupted"; reason: string } | null,
    durablePrefix: durable as IsolatedCut | null, summary, journal, replay, probe, receipt };
}
