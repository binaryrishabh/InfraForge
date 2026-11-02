import { keyedUniform } from "../random";
import type { RateArrivals, TraceRow } from "./contracts";
import { WORKLOAD_LIMITS } from "./policy";

export const POISSON_PROVENANCE = "product-arrivals/2: seeded Poisson integrated exponential hazard across piecewise-constant peak/load intervals; independent keyed arrival-operation read choice; integer microsecond rounding";

// Integrate one hazard per arrival across every rate boundary, including stopped traffic.
export function* poissonRows(r: RateArrivals, seed: string, sourceId: string): Generator<TraceRow> {
  let time = r.startUs, index = 0, change = 0, fraction = 1, intervals = 0;
  while (time < r.endUs) {
    let hazard = -Math.log1p(-keyedUniform(seed, sourceId, JSON.stringify([index]), "arrival-gap"));
    while (time < r.endUs) {
      if (++intervals > WORKLOAD_LIMITS.events) throw Error("Poisson rate interval budget exceeded");
      while (change < r.changes.length && r.changes[change]!.atUs <= time) fraction = r.changes[change++]!.fraction;
      if (fraction === 0) {
        const next = r.changes.slice(change).find(c => c.fraction > 0);
        if (!next || next.atUs >= r.endUs) return;
        time = next.atUs; continue;
      }
      let boundary = Math.min(r.endUs, r.changes[change]?.atUs ?? r.endUs), multiplier = 1;
      const p = r.peak;
      if (p) {
        if (time < p.startUs) boundary = Math.min(boundary, p.startUs);
        else {
          const start = p.everyUs === undefined ? p.startUs : p.startUs + Math.floor((time - p.startUs) / p.everyUs) * p.everyUs;
          const end = start + p.endUs - p.startUs;
          if (time < end) { multiplier = p.multiplier; boundary = Math.min(boundary, end); }
          else if (p.everyUs !== undefined) boundary = Math.min(boundary, start + p.everyUs);
        }
      }
      const intensity = fraction * multiplier / r.intervalUs, available = intensity * (boundary - time);
      if (hazard >= available) { hazard -= available; time = boundary; continue; }
      time += hazard / intensity;
      const atUs = Math.round(time);
      if (!Number.isSafeInteger(atUs)) throw Error("Poisson timestamp outside safe microsecond domain");
      if (atUs >= r.endUs) return;
      const read = keyedUniform(seed, sourceId, JSON.stringify([index]), "arrival-operation") < r.readFraction;
      yield { id: `arrival-${index++}`, atUs, operation: read ? r.readOperation : r.writeOperation };
      break;
    }
  }
}
