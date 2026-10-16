import { canonical } from "../../model2/product/provenance";
import { digest } from "../provider/fingerprint";
import type { ContentHasher } from "../provider/fingerprint";
import { fraction } from "../provider/exact";
import type { UsageSnapshot } from "./measurements";
import { configValid, count, retainedSize } from "./validation";
import { objectKey, objectRow } from "./validation";

type Unit = "byte-us" | "bytes" | "operations" | "count";
export interface MeterQuantity { source: string; resource: string; metric: string; unit: Unit; value: string }
export interface MeterBoundary { source: string; resource: string; metric: string; unit: Unit; from: string; to: string }
export interface ObservedUsageWindow {
  schema: "infraforge-usage-window/1";
  kind: "Observed";
  identity: { run: string; epoch: string; inputFingerprint: string; selection: string };
  from: { atUs: number; snapshot: string };
  to: { atUs: number; snapshot: string };
  quantities: MeterQuantity[];
  boundaries: MeterBoundary[];
  provenance: string[];
  providerBilling: "Unknown";
  fingerprint: string;
}
export type UsageWindow = ObservedUsageWindow | { kind: "Unknown"; reason: string; provenance: string[] };
const integer = (value: string) => BigInt(fraction(value).numerator);
const key = (q: Pick<MeterQuantity, "source" | "metric" | "unit">) => JSON.stringify([q.source, q.metric, q.unit]);
function verify(snapshot: UsageSnapshot, hasher: ContentHasher) {
  configValid(snapshot.config); retainedSize(snapshot, 500000, 4000000); count(snapshot.atUs);
  const { fingerprint, ...payload } = snapshot;
  if (snapshot.schema !== "infraforge-usage-snapshot/1" || digest(payload, hasher) !== fingerprint) throw Error("Usage snapshot version/content drift");
  if (!snapshot.complete || snapshot.reasons.length || snapshot.omittedRecords || snapshot.sources.some((s) => s.producerHead !== s.collectedHead)) throw Error("Usage coverage incomplete, reset or missing observations");
  if (new Set(snapshot.sources.map((s) => s.id)).size !== snapshot.sources.length || snapshot.measurements.length !== snapshot.sources.length) throw Error("Usage source cardinality mismatch");
  if (new Set(snapshot.measurements.map((m) => JSON.stringify([m.family, m.resource]))).size !== snapshot.measurements.length) throw Error("Duplicate usage owner");
  const expected = [...snapshot.config.objects.map((id) => JSON.stringify(["object-store", id, "atomic-current-object/1"])), ...snapshot.config.links.map((id) => JSON.stringify(["link", id, "directed-payload/1"]))].sort();
  if (JSON.stringify(snapshot.sources.map((s) => s.id).sort()) !== JSON.stringify(expected)) throw Error("Selected usage coverage missing or unsupported");
  for (const source of snapshot.sources) {
    count(source.collectedHead); count(source.producerHead);
    if (source.id !== JSON.stringify([source.descriptor.family, source.descriptor.resource, source.descriptor.profile]) || !snapshot.measurements.some((m) => m.family === source.descriptor.family && m.resource === source.descriptor.resource)) throw Error("Usage producer identity mismatch");
  }
  for (const m of snapshot.measurements) {
    if (m.family === "object-store") {
      const rows = m.objects.map(objectRow);
      if (new Set(rows.map(objectKey)).size !== rows.length || rows.reduce((n, r) => n + BigInt(r.bytes), 0n) !== integer(m.storedBytes)) throw Error("Stored-byte conservation failed");
      const c = m.operations;
      if (integer(c.received) !== integer(c.admitted) + integer(c.rejected) || integer(c.admitted) !== integer(c.completed) + integer(c.failed) + integer(c.cancelled) + integer(c.live)) throw Error("Operation population conservation failed");
      count(m.generation);
      if (rows.some((r) => r.generation > m.generation) || new Set(m.commands.map((r) => r.command)).size !== m.commands.length) throw Error("Object generation or command identity mismatch");
      for (const name of Object.keys(c) as Array<keyof typeof c>) if (integer(c[name]) !== m.commands.reduce((n, command) => n + integer(command.counts[name]), 0n)) throw Error("Command attribution conservation failed");
    } else {
      for (const c of [m.totals, ...Object.values(m.directions)]) {
        if (integer(c.offeredBytes) !== integer(c.acceptedBytes) + integer(c.rejectedBytes) || integer(c.acceptedBytes) !== integer(c.deliveredBytes) + integer(c.failedBytes) + integer(c.liveBytes) || integer(c.offeredTransfers) !== integer(c.terminalTransfers) + integer(c.liveTransfers)) throw Error("Directed payload conservation failed");
      }
      for (const name of Object.keys(m.totals) as Array<keyof typeof m.totals>) if (integer(m.totals[name]) !== Object.values(m.directions).reduce((n, c) => n + integer(c[name]), 0n)) throw Error("Transfer direction attribution conservation failed");
    }
  }
}
export function usageWindow(before: UsageSnapshot, after: UsageSnapshot, hasher: ContentHasher): UsageWindow {
  const provenance = [...(before.config?.provenance ?? []), ...(after.config?.provenance ?? [])];
  try {
    verify(before, hasher); verify(after, hasher);
    if (digest(before.config, hasher) !== digest(after.config, hasher) || after.atUs < before.atUs) throw Error("Usage run/input/epoch/selection changed or time reversed");
    const descriptors = (s: UsageSnapshot) => s.sources.map((p) => [p.id, p.descriptor]);
    if (digest(descriptors(before), hasher) !== digest(descriptors(after), hasher) || after.sources.some((s, i) => s.collectedHead < before.sources[i]!.collectedHead)) throw Error("Usage producer reset, gap or scope change");
    const quantities: MeterQuantity[] = [], boundaries: MeterBoundary[] = [];
    function add(source: string, resource: string, metric: string, unit: Unit, from: string, to: string) {
      const value = integer(to) - integer(from); if (value < 0n) throw Error(`Cumulative usage reset: ${metric}`);
      quantities.push({ source, resource, metric, unit, value: String(value) });
    }
    function boundary(source: string, resource: string, metric: string, unit: Unit, from: string, to: string) {
      integer(from); integer(to); boundaries.push({ source, resource, metric, unit, from, to });
    }
    for (const current of after.measurements) {
      const previous = before.measurements.find((m) => m.family === current.family && m.resource === current.resource), source = after.sources.find((s) => s.descriptor.family === current.family && s.descriptor.resource === current.resource)?.id;
      if (!previous || !source) throw Error("Usage source missing");
      if (current.family === "object-store" && previous.family === "object-store") {
        if (previous.commands.some((p) => !current.commands.some((c) => c.command === p.command))) throw Error("Operation dimension disappeared/reset");
        if (integer(current.storedBytes) + integer(current.releasedBytes) - integer(previous.releasedBytes) !== integer(previous.storedBytes) + integer(current.createdBytes) - integer(previous.createdBytes) || BigInt(current.generation) - BigInt(previous.generation) !== integer(current.committedPuts) - integer(previous.committedPuts)) throw Error("Object mutation conservation or generation reset");
        add(source, current.resource, "current-object.byte-time", "byte-us", previous.byteUs, current.byteUs);
        for (const name of ["createdBytes", "releasedBytes"] as const) add(source, current.resource, name, "bytes", previous[name], current[name]);
        for (const name of ["committedPuts", "replacedObjects", "removedObjects"] as const) add(source, current.resource, name, "count", previous[name], current[name]);
        for (const name of ["received", "admitted", "completed", "failed", "rejected", "cancelled"] as const) add(source, current.resource, `operation.${name}`, "operations", previous.operations[name], current.operations[name]);
        boundary(source, current.resource, "current-object.bytes", "bytes", previous.storedBytes, current.storedBytes);
        boundary(source, current.resource, "operation.live", "count", previous.operations.live, current.operations.live);
        boundary(source, current.resource, "current-object.generation", "count", String(previous.generation), String(current.generation));
        for (const command of current.commands) {
          const prior = previous.commands.find((c) => c.command === command.command);
          for (const name of ["received", "admitted", "completed", "failed", "rejected", "cancelled"] as const) add(source, current.resource, JSON.stringify(["command", command.command, name]), "operations", prior?.counts[name] ?? "0", command.counts[name]);
          boundary(source, current.resource, JSON.stringify(["command", command.command, "live"]), "count", prior?.counts.live ?? "0", command.counts.live);
        }
      } else if (current.family === "link" && previous.family === "link") {
        if (current.from !== previous.from || current.to !== previous.to) throw Error("Transfer endpoint scope changed");
        const groups = [["total", previous.totals, current.totals], ...(["request", "response", "unattributed"] as const).map((d) => [d, previous.directions[d], current.directions[d]] as const)] as const;
        for (const [group, from, to] of groups) {
          for (const name of ["offeredBytes", "acceptedBytes", "rejectedBytes", "deliveredBytes", "failedBytes"] as const) add(source, current.resource, `${group}.${name}`, "bytes", from[name], to[name]);
          for (const name of ["offeredTransfers", "terminalTransfers"] as const) add(source, current.resource, `${group}.${name}`, "count", from[name], to[name]);
          boundary(source, current.resource, `${group}.liveBytes`, "bytes", from.liveBytes, to.liveBytes);
          boundary(source, current.resource, `${group}.liveTransfers`, "count", from.liveTransfers, to.liveTransfers);
        }
      } else throw Error("Usage family changed");
    }
    const payload = { schema: "infraforge-usage-window/1" as const, kind: "Observed" as const, identity: { run: before.config.run, epoch: before.config.epoch, inputFingerprint: before.config.inputFingerprint, selection: digest(descriptors(before), hasher) },
      from: { atUs: before.atUs, snapshot: before.fingerprint }, to: { atUs: after.atUs, snapshot: after.fingerprint }, quantities: quantities.sort((a, b) => key(a) < key(b) ? -1 : 1), boundaries: boundaries.sort((a, b) => key(a) < key(b) ? -1 : 1),
      provenance: [...before.config.provenance, `snapshot:${before.fingerprint}`, `snapshot:${after.fingerprint}`], providerBilling: "Unknown" as const };
    return canonical({ ...payload, fingerprint: digest(payload, hasher) });
  } catch (cause) { return { kind: "Unknown", reason: cause instanceof Error ? cause.message : "Invalid usage window", provenance }; }
}
