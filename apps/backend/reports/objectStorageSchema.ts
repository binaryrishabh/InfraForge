import { z } from "zod";

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const nullable = count.nullable();
const identity = z.string().min(1).max(1024);
const inventory = z.array(z.object({ namespace: identity, key: identity, generation: count, bytes: count }).strict()).max(100);

/** Preserve older partial observations; validate new evidence without repairing it. */
export const ObjectStorageSchema = z.object({
  version: z.literal(1), storedBytes: nullable, capacityBytes: nullable,
  committedPuts: nullable, replacedObjects: nullable, removedObjects: nullable, deletes: nullable,
  "object-capacity": nullable,
  sampledAtUs: nullable.optional(), puts: nullable.optional(), gets: nullable.optional(), heads: nullable.optional(),
  generation: nullable.optional(), objectCount: nullable.optional(), overCapacity: z.boolean().nullable().optional(),
  generatedResponseBodyBytes: nullable.optional(),
  commandReasons: z.record(z.string().min(1).max(256), count).refine(v => Object.keys(v).length <= 64).nullable().optional(),
  objects: inventory.nullable().optional(), omittedObjects: nullable.optional(),
}).strict().superRefine((m, ctx) => {
  const refuse = () => ctx.addIssue({ code: "custom", message: "Inconsistent object storage ownership observations" });
  if (m.replacedObjects != null && m.committedPuts != null && m.replacedObjects > m.committedPuts) refuse();
  if (m.removedObjects != null && m.deletes != null && m.removedObjects > m.deletes) refuse();
  if (m.puts != null && m.committedPuts != null) {
    if (m.committedPuts > m.puts) refuse();
    // The engine's complete sparse map omits reasons which have never occurred.
    // This checks conservation; it never fills a missing saved field with zero.
    if (m.commandReasons != null && m.puts - m.committedPuts !== (m.commandReasons["object-capacity"] ?? 0)) refuse();
  }
  if (m.commandReasons != null && m["object-capacity"] != null && m["object-capacity"] !== m.commandReasons["object-capacity"]) refuse();
  if (m.overCapacity != null && m.storedBytes != null && m.capacityBytes != null && m.overCapacity !== (m.storedBytes > m.capacityBytes)) refuse();
  if (m.objects) {
    if (new Set(m.objects.map(o => JSON.stringify([o.namespace, o.key]))).size !== m.objects.length) refuse();
    if (m.objectCount != null && m.omittedObjects != null && m.objectCount - m.objects.length !== m.omittedObjects) refuse();
    if (m.generation != null && m.objects.some(o => o.generation > m.generation!)) refuse();
    const bytes = m.objects.reduce((sum, o) => sum + o.bytes, 0);
    if (!Number.isSafeInteger(bytes) || m.storedBytes != null && (bytes > m.storedBytes || m.omittedObjects === 0 && bytes !== m.storedBytes)) refuse();
  }
});
