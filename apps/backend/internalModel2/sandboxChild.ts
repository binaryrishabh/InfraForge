// This entrypoint has no database, Redis or authentication imports. JSON is data;
// only the shipped Model-2 engine executes inside the disposable container.
import { createInterface } from "node:readline";
import { once } from "node:events";
import { readEnvelope, captureCuts } from "./envelope";
import { capture, instantiate } from "./capture";
import { replayStored } from "./report";
import { sandboxReady } from "./sandboxHandshake";
import { LESSON_SANDBOX as limits } from "./lessonLimits";
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]();
const read = async () => {
  const line = await lines.next();
  if (line.done || Buffer.byteLength(line.value) > limits.inputBytes) throw Error("Missing or oversized parent message");
  return JSON.parse(line.value);
};
const send = async (value: unknown) => { if (!process.stdout.write(JSON.stringify(value) + "\n")) await once(process.stdout, "drain"); };
const request = await read();
await send(sandboxReady());
if (request.mode === "replay") {
  await send({ kind: "replay", value: replayStored(request.row) });
} else if (request.mode === "execute") {
  const input = readEnvelope(request.input, request.inputHash), runtime = instantiate(input);
  let previous: ReturnType<typeof capture> | undefined;
  for (const at of captureCuts(input)) {
    runtime.advanceTo(at);
    const value = capture(runtime, input, (previous?.sequence ?? 0) + 1, previous?.checkpoints ?? []);
    await send({ kind: "capture", value });
    const ack = await read();
    if (ack.sequence !== value.sequence || ack.fingerprint !== value.fingerprint || typeof ack.continue !== "boolean") throw Error("Invalid durable acknowledgement");
    if (!ack.continue) process.exit(0);
    previous = value;
  }
} else throw Error("Unsupported child mode");
await send({ kind: "done" });
process.exit(0);
