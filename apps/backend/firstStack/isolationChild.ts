// No database, Redis, authentication or network clients are imported here.
// Only shipped code executes; stdin contains bounded JSON data and ACKs.
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { executionSource } from "../internalModel2/identity";
import { prepareFirstStackExecution } from "./execution";
import { executeFirstStackBounded } from "./boundedExecution";
import { replayFirstStackPrefix } from "./isolationReplay";
import { boundedLines, inputDigest, isolatedCut, type IsolatedInput } from "./isolationProtocol";
import { FIRST_STACK_ISOLATION as limits } from "./isolationPolicy";
import { boundedJson } from "@infraforge/simulation/internal-first-stack";
import { isolationSelfCheck } from "./isolationSelfCheck";

const input = boundedLines(process.stdin, limits.inputBytes, limits.inputBytes + 2 * 1024 * 1024)[Symbol.asyncIterator]();
async function read() { const row = await input.next(); if (row.done) throw Error("Parent disconnected"); return row.value; }
let output = 0;
async function send(value: unknown) {
  const line = boundedJson(value, limits.lineBytes) + "\n";
  output += Buffer.byteLength(line);
  if (output > limits.outputBytes) throw Error("Isolated child output budget exceeded");
  if (!process.stdout.write(line)) await once(process.stdout, "drain");
}
const cgroup = (name: string) => readFileSync(`/sys/fs/cgroup/${name}`, "utf8").trim();
await send({ kind: "ready", source: executionSource, enforcement: {
  memory: cgroup("memory.max"), swap: cgroup("memory.swap.max"), cpu: cgroup("cpu.max"), pids: cgroup("pids.max"),
  uid: process.getuid!(), gid: process.getgid!(), limits: readFileSync("/proc/self/limits", "utf8"),
  status: readFileSync("/proc/self/status", "utf8"),
} });
const request = JSON.parse(await read());
if (!["execute", "replay", "canary"].includes(request.mode) || request.source !== executionSource) throw Error("Unsupported child request/source");
const serialized = await read(), inputHash = inputDigest(serialized);
if (inputHash !== request.inputHash) throw Error("Immutable execution input changed");
const data: IsolatedInput = JSON.parse(serialized);
const prepared = prepareFirstStackExecution(data.owner, data.layout, data.candidate, data.recording, data.policy);
if (request.mode === "replay" || request.mode === "canary") {
  if (request.mode === "canary") isolationSelfCheck();
  await send({ kind: "replay", value: await replayFirstStackPrefix(prepared, request.expected, executionSource, inputHash) });
} else {
  const result = await executeFirstStackBounded(prepared, { maxCpuUs: limits.cpuSeconds * 1_000_000, persist: async text => {
    const value = isolatedCut(JSON.parse(text), executionSource, inputHash);
    await send({ kind: "cut", value });
    const ack = JSON.parse(await read());
    if (ack.kind !== "ack" || ack.sequence !== value.cut.sequence || ack.fingerprint !== value.fingerprint || ack.continue !== true) {
      throw Error("Durable ACK refused; last committed prefix remains authoritative");
    }
  } });
  for (const artifact of ["summary", "journal"] as const) {
    const text = result[artifact];
    if (text !== null) for (let at = 0, index = 0; at < text.length; at += 64 * 1024, index++) {
      await send({ kind: "artifact", artifact, index, text: text.slice(at, at + 64 * 1024) });
    }
  }
  await send({ kind: "result", status: result.status, interruption: result.interruption });
}
await send({ kind: "done" });
process.exit(0);
