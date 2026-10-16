import { canonical } from "../../model2/product/provenance";
import { digest } from "../provider/fingerprint";
import type { ContentHasher } from "../provider/fingerprint";
import { fraction } from "../provider/exact";
import type { MeterBoundary, MeterQuantity, ObservedUsageWindow, UsageWindow } from "./windows";
import { retainedSize } from "./validation";

const key = (q: Pick<MeterQuantity, "source" | "metric" | "unit">) => JSON.stringify([q.source, q.metric, q.unit]);
const integer = (v: string) => BigInt(fraction(v).numerator);
function commandMetric(metric: string) {
  try { const parts: unknown = JSON.parse(metric); return Array.isArray(parts) && parts.length === 3 && parts[0] === "command"; } catch { return false; }
}
export function combineUsageWindows(windows: UsageWindow[], hasher: ContentHasher): UsageWindow {
  const provenance = windows.flatMap((w) => w.provenance).slice(0, 32);
  try {
    if (!windows.length || windows.length > 128 || windows.some((w) => w.kind !== "Observed")) throw Error("Missing, over-budget or Unknown usage windows");
    const known = windows as ObservedUsageWindow[];
    const fingerprints = new Set<string>();
    for (const w of known) {
      retainedSize(w, 500000, 4000000);
      const { fingerprint, ...body } = w;
      if (w.schema !== "infraforge-usage-window/1" || digest(body, hasher) !== fingerprint || fingerprints.has(fingerprint)) throw Error("Duplicate or changed usage window");
      fingerprints.add(fingerprint);
    }
    const first = known[0]!, quantities = new Map<string, MeterQuantity>(), boundaries = new Map<string, MeterBoundary>();
    for (const q of first.quantities) { if (quantities.has(key(q))) throw Error("Duplicate metric"); integer(q.value); quantities.set(key(q), { ...q }); }
    for (const q of first.boundaries) { if (boundaries.has(key(q))) throw Error("Duplicate metric boundary"); integer(q.from); integer(q.to); boundaries.set(key(q), { ...q }); }
    for (let i = 1; i < known.length; i++) {
      const previous = known[i - 1]!, current = known[i]!;
      if (digest(first.identity, hasher) !== digest(current.identity, hasher) || digest(previous.to, hasher) !== digest(current.from, hasher)) throw Error("Overlapping, gapped, reset or differently scoped usage windows; ordered adjacent cuts required");
      const incoming = new Map(current.quantities.map((q) => [key(q), q])), incomingBounds = new Map(current.boundaries.map((q) => [key(q), q]));
      if (incoming.size !== current.quantities.length || incomingBounds.size !== current.boundaries.length) throw Error("Duplicate metric");
      for (const [id, prior] of quantities) if (!incoming.has(id)) throw Error(`Usage dimension disappeared: ${prior.metric}`);
      for (const [id, q] of incoming) {
        const prior = quantities.get(id);
        if (!prior && !commandMetric(q.metric)) throw Error("Usage dimensions changed");
        if (prior && prior.resource !== q.resource) throw Error("Usage ownership changed");
        quantities.set(id, { ...q, value: String(integer(prior?.value ?? "0") + integer(q.value)) });
      }
      for (const [id, prior] of boundaries) if (!incomingBounds.has(id)) throw Error(`Usage boundary disappeared: ${prior.metric}`);
      for (const [id, q] of incomingBounds) {
        const prior = boundaries.get(id);
        if (!prior && (!commandMetric(q.metric) || q.from !== "0")) throw Error("Usage boundary scope changed");
        if (prior && (prior.resource !== q.resource || prior.to !== q.from)) throw Error("Usage boundary population mismatch");
        integer(q.from); integer(q.to); boundaries.set(id, { ...q, from: prior?.from ?? "0" });
      }
    }
    const last = known.at(-1)!, body = { ...first, to: last.to, quantities: [...quantities.values()].sort((a, b) => key(a) < key(b) ? -1 : 1), boundaries: [...boundaries.values()].sort((a, b) => key(a) < key(b) ? -1 : 1),
      provenance: [...first.provenance.filter((p) => !p.startsWith("snapshot:")), `snapshot:${first.from.snapshot}`, `snapshot:${last.to.snapshot}`] };
    const { fingerprint: _old, ...payload } = body;
    return canonical({ ...payload, fingerprint: digest(payload, hasher) });
  } catch (cause) { return { kind: "Unknown", reason: cause instanceof Error ? cause.message : "Invalid usage aggregation", provenance }; }
}
