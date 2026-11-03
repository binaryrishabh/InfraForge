import { requireKnown, type Quantity, type Unit } from "../../reality/quantity";
import type { AsyncInput } from "../async/contracts";
import type { EventBusConfig } from "./contracts";
import { micros } from "../time";

export function validateEventBus(r: EventBusConfig, i: AsyncInput) {
  const n = <U extends Unit>(q: Quantity<U>, unit: U, min: number, max: number) => {
    const value = requireKnown(q, unit);
    if (!Number.isSafeInteger(value) || value < min || value > max || !q.provenance.length || q.provenance.some(id => { const entry = i.ledger.find(e => e.id === id)?.quantity; return entry?.kind !== "known" || entry.unit !== unit || entry.value !== value; })) throw Error("Invalid event bus bounded quantity/provenance");
    return value;
  };
  if (r.profile !== "independent-pubsub/1" || !Array.isArray(r.subscriptions) || r.subscriptions.length < 1 || r.subscriptions.length > 16 || new Set(r.subscriptions.map(s => s.id)).size !== r.subscriptions.length || new Set(r.subscriptions.map(s => s.target)).size !== r.subscriptions.length) throw Error("Invalid event bus subscriptions");
  for (const s of r.subscriptions) if (!/^[a-zA-Z0-9_-]{1,64}$/.test(s.id) || i.resources.find(t => t.id === s.target)?.kind !== "delivery-queue" || !i.paths.some(p => p.source === r.id && p.target === s.target) || (s.keyPrefix !== undefined && (typeof s.keyPrefix !== "string" || s.keyPrefix.length < 1 || s.keyPrefix.length > 128))) throw Error("Invalid event bus subscriber path/filter");
  n(r.capacityMessages, "count", 1, 10000); n(r.maxAttempts, "count", 1, 10); n(r.deadLetterCapacity, "count", 0, 10000);
  for (const time of [r.retryDelay, r.deliveryTimeout]) micros(requireKnown(i.horizon, "us") + n(time, "us", 1000, 60000000));
  if (Object.keys(r.demands).length !== 1 || !r.demands.publish) throw Error("Event bus accepts publish commands only");
}
