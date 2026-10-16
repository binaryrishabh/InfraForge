import { requireKnown } from "../../reality/quantity";
import type { EventKernel } from "../time";
import type { Invocation } from "../workload/contracts";
import type { ObjectConfig, ObjectRow, ObjectRequest, ObjectReply } from "./contracts";
import { commandService } from "./commands";
import { ASYNC_LIMITS } from "./policy";
import type { RuntimeUsageObserver, StoredObject } from "../../reality/metering/contracts";
import { usageSource } from "../../reality/metering/port";
export function objectStore(config: ObjectConfig, kernel: EventKernel, observer?: RuntimeUsageObserver) {
  const objects = new Map<string, ObjectRow>(), keyOf = (namespace: string, key: string) => JSON.stringify([namespace, key]);
  let generation = 0, used = 0, capacity = config.capacity ? requireKnown(config.capacity, "bytes") : undefined, reads = true, writes = true, puts = 0, gets = 0, heads = 0, deletes = 0, committed = 0, replaced = 0, removed = 0, responseBytes = 0;
  const valid = (s: string) => typeof s === "string" && s.length > 0 && s.length <= ASYNC_LIMITS.keyCharacters;
  for (const row of config.initial) { const bytes = requireKnown(row.bytes, "bytes"); objects.set(keyOf(row.namespace, row.key), { ...row, bytes }); used += bytes; generation = Math.max(generation, row.generation); }
  const usage = usageSource({ family: "object-store", resource: config.id, profile: config.profile }, kernel, observer);
  const stored = (row: ObjectRow): StoredObject => ({ namespace: row.namespace, key: row.key, generation: row.generation, bytes: row.bytes });
  usage?.({ kind: "object-origin", objects: [...objects.values()].map(stored) });
  const apply = (work: Invocation, request: number): ObjectReply => {
    const r = work.message?.request as ObjectRequest | undefined; if (!r || !valid(r.key) || !valid(r.namespace)) return { ok: false, reason: "invalid-object-identity" };
    const key = keyOf(r.namespace, r.key), previous = objects.get(key);
    if (r.kind === "get" || r.kind === "head") {
      if (r.kind === "get") gets++; else heads++; if (!reads) return { ok: false, reason: "reads-unavailable" }; if (!previous) return { ok: false, reason: "not-found" };
      if (r.ifGeneration !== undefined && r.ifGeneration !== previous.generation) return { ok: false, reason: "precondition-failed" };
      const bytes = r.kind === "get" ? previous.bytes : 0; if (work.message) work.message.bodyBytes = { response: bytes }; responseBytes += bytes; return { ok: true, object: { ...previous } };
    }
    if (!writes) return { ok: false, reason: "writes-unavailable" };
    if ((r.ifAbsent && previous) || (r.ifGeneration !== undefined && previous?.generation !== r.ifGeneration)) return { ok: false, reason: "precondition-failed" };
    if (r.kind === "delete") { deletes++; if (previous) { objects.delete(key); used -= previous.bytes; removed++; usage?.({ kind: "object-mutation", request, command: "delete", before: stored(previous), after: null }); } return { ok: true, deleted: !!previous }; }
    if (r.kind !== "put" || !Number.isSafeInteger(r.bytes) || r.bytes! < 0 || !valid(r.content!)) return { ok: false, reason: "invalid-put" };
    puts++; const nextBytes = used - (previous?.bytes ?? 0) + r.bytes!;
    if (!Number.isSafeInteger(nextBytes) || !Number.isSafeInteger(generation + 1) || (capacity !== undefined && nextBytes > capacity) || (!previous && objects.size >= ASYNC_LIMITS.objects)) return { ok: false, reason: "object-capacity" };
    const object: ObjectRow = { namespace: r.namespace, key: r.key, generation: ++generation, bytes: r.bytes!, content: r.content! };
    objects.set(key, object); used = nextBytes; committed++; if (previous) replaced++;
    usage?.({ kind: "object-mutation", request, command: "put", before: previous ? stored(previous) : null, after: stored(object) });
    return { ok: true, object: { ...object } };
  };
  const service = commandService(config.id, config, kernel, apply, usage);
  return { ...service, access(read: boolean, write: boolean) { reads = read; writes = write; }, capacity(bytes: number | undefined) { capacity = bytes; }, evidence: () => ({ id: config.id, objects: [...objects.values()].sort((a, b) => keyOf(a.namespace, a.key) < keyOf(b.namespace, b.key) ? -1 : 1).map((r) => ({ ...r })), storedBytes: used, capacityBytes: capacity ?? null, overCapacity: capacity !== undefined && used > capacity, generation, puts, gets, heads, deletes, committedPuts: committed, replacedObjects: replaced, removedObjects: removed, generatedResponseBodyBytes: responseBytes, reads, writes, service: service.evidence(), physicalDurability: "Unknown", storageDeviceDemand: "Unknown" }) };
}
