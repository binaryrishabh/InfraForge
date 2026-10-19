import { z } from "zod";
import { firstStackLimits as limits } from "@infraforge/contracts/first-stack";
import { WorkloadRefusal } from "./workload";

const contextSchema = z.object({ infrastructureId: z.uuid(), expectedDesignUpdatedAt: z.iso.datetime(),
  parameters: z.json(), transform: z.json().optional() }).strict();

// HTTP framing: one bounded JSON context line, followed by the unchanged JSONL
// schedule. The context is not part of the normalized recording or its hash.
export async function readImportContext(input: AsyncIterable<Uint8Array>) {
  const iterator = input[Symbol.asyncIterator](), prefix = new Uint8Array(limits.parameterBytes + 1024);
  let length = 0;
  while (true) {
    const item = await iterator.next();
    if (item.done) throw new WorkloadRefusal("IMPORT_CONTEXT", "context", "Missing context line");
    const chunk = item.value;
    if (!(chunk instanceof Uint8Array) || chunk.byteLength > limits.scheduleBytes + prefix.byteLength) throw new WorkloadRefusal("IMPORT_BYTES", "context", "Import byte budget exceeded");
    const newline = chunk.indexOf(10), part = newline < 0 ? chunk : chunk.subarray(0, newline);
    if (length + part.length > prefix.byteLength) throw new WorkloadRefusal("PARAMETER_BYTES", "context", "Context byte budget exceeded before parsing");
    prefix.set(part, length); length += part.length;
    if (newline < 0) continue;
    let context: z.infer<typeof contextSchema>;
    try { context = contextSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(prefix.subarray(0, length)))); }
    catch { throw new WorkloadRefusal("IMPORT_CONTEXT", "context", "Invalid UTF-8, JSON or context fields"); }
    const tail = chunk.subarray(newline + 1);
    async function* schedule() {
      try {
        if (tail.length) yield tail;
        while (true) { const next = await iterator.next(); if (next.done) return; yield next.value; }
      } finally { await iterator.return?.(); }
    }
    return { context, schedule: schedule() };
  }
}
