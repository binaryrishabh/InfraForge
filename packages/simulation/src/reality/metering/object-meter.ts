import type { StoredObject, UsageDetail } from "./contracts";
import type { ObjectMeasurement, OperationCounts } from "./measurements";
import { count, objectKey, objectRow, text } from "./validation";

const counters = () => ({ received: 0n, admitted: 0n, completed: 0n, failed: 0n, rejected: 0n, cancelled: 0n });
type Counters = ReturnType<typeof counters>;
const counts = (c: Counters): OperationCounts => ({ received: String(c.received), completed: String(c.completed), failed: String(c.failed), rejected: String(c.rejected), cancelled: String(c.cancelled), admitted: String(c.admitted), live: String(c.received - c.completed - c.failed - c.rejected - c.cancelled) });
export class ObjectMeter {
  private origin = false;
  private objects = new Map<string, StoredObject>();
  private requests = new Map<number, { command: string | null; admitted: boolean; changed: boolean }>();
  private commands = new Map<string, { command: string | null; totals: Counters }>();
  private totals = counters();
  private bytes = 0n;
  private area = 0n;
  private lastAt = 0;
  private generation = 0;
  private puts = 0n;
  private replaced = 0n;
  private removed = 0n;
  private createdBytes = 0n;
  private releasedBytes = 0n;
  constructor(readonly resource: string) {}
  apply(detail: UsageDetail, at: number) {
    count(at);
    if (at < this.lastAt) throw Error("Late object event cannot rewrite an issued time sequence");
    this.area += this.bytes * BigInt(at - this.lastAt); this.lastAt = at;
    if (detail.kind === "object-origin") {
      if (this.origin || this.totals.received || at !== 0) throw Error("Object origin is missing, repeated or not at run origin");
      this.origin = true;
      for (const value of detail.objects) { const row = objectRow(value), key = objectKey(row); if (this.objects.has(key)) throw Error("Duplicate initial object"); this.objects.set(key, row); this.bytes += BigInt(row.bytes); this.generation = Math.max(this.generation, row.generation); }
      return;
    }
    if (!this.origin) throw Error("Object origin missing");
    if (detail.kind === "operation-start") {
      if (count(detail.request) !== this.totals.received + 1n || this.requests.has(detail.request) || typeof detail.admitted !== "boolean") throw Error("Request receipt sequence gap/duplicate");
      text(detail.callId); text(detail.rootId); if (count(detail.attempt) < 1n) throw Error("Request attempt identity missing");
      if (detail.command !== null) text(detail.command);
      const key = JSON.stringify(detail.command), command = this.commands.get(key) ?? { command: detail.command, totals: counters() };
      this.commands.set(key, command); this.requests.set(detail.request, { command: detail.command, admitted: detail.admitted, changed: false }); this.totals.received++; command.totals.received++;
      if (detail.admitted) { this.totals.admitted++; command.totals.admitted++; }
      return;
    }
    if (detail.kind === "operation-end") {
      const request = this.requests.get(detail.request);
      if (!request || !["completed", "failed", "rejected", "cancelled"].includes(detail.outcome) || detail.reason !== null && typeof detail.reason !== "string") throw Error("Unmatched request terminal");
      if ((detail.outcome === "rejected") === request.admitted) throw Error("Request admission and terminal disagree");
      if (detail.reason !== null) text(detail.reason);
      if (request.changed && detail.outcome !== "completed") throw Error("Object commit and service terminal disagree");
      this.requests.delete(detail.request); this.totals[detail.outcome]++; this.commands.get(JSON.stringify(request.command))!.totals[detail.outcome]++;
      return;
    }
    if (detail.kind !== "object-mutation") throw Error("Wrong object usage dimension");
    const request = this.requests.get(detail.request);
    if (!request || !request.admitted || request.changed || request.command !== detail.command || !["put", "delete"].includes(detail.command)) throw Error("Mutation has no matching live request");
    const before = detail.before ? objectRow(detail.before) : null, after = detail.after ? objectRow(detail.after) : null, identity = after ?? before;
    if (!identity || before && after && objectKey(before) !== objectKey(after)) throw Error("Mutation identity mismatch");
    const key = objectKey(identity), previous = this.objects.get(key) ?? null;
    if (JSON.stringify(previous) !== JSON.stringify(before)) throw Error("Missing mutation or mismatched prior generation/bytes");
    if (detail.command === "put") {
      if (!after || after.generation !== this.generation + 1) throw Error("Put generation is not the next actual store generation");
      this.generation = after.generation; this.objects.set(key, after); this.puts++; if (before) this.replaced++;
    } else {
      if (!before || after) throw Error("Delete must remove an actual current object");
      this.objects.delete(key); this.removed++;
    }
    this.createdBytes += BigInt(after?.bytes ?? 0); this.releasedBytes += BigInt(before?.bytes ?? 0);
    this.bytes += BigInt(after?.bytes ?? 0) - BigInt(before?.bytes ?? 0); request.changed = true;
  }
  snapshot(at: number): ObjectMeasurement {
    count(at); if (!this.origin || at < this.lastAt) throw Error("Object observation is incomplete or precedes its history");
    return { family: "object-store", resource: this.resource, storedBytes: String(this.bytes), byteUs: String(this.area + this.bytes * BigInt(at - this.lastAt)), generation: this.generation,
      objects: [...this.objects.values()].sort((a, b) => objectKey(a) < objectKey(b) ? -1 : 1).map((r) => ({ ...r })), committedPuts: String(this.puts), replacedObjects: String(this.replaced), removedObjects: String(this.removed), createdBytes: String(this.createdBytes), releasedBytes: String(this.releasedBytes), operations: counts(this.totals),
      commands: [...this.commands.values()].sort((a, b) => JSON.stringify(a.command) < JSON.stringify(b.command) ? -1 : 1).map((c) => ({ command: c.command, counts: counts(c.totals) })) };
  }
}
