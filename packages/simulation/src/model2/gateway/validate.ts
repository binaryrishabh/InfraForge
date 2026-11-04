import { gatewayPath } from "@infraforge/domain/resource";
import { requireKnown, type Quantity, type Unit } from "../../reality/quantity";
import type { AsyncInput } from "../async/contracts";
import type { GatewayConfig } from "./contracts";
import { micros } from "../time";
export function validateGateway(r: GatewayConfig, i: AsyncInput) {
  const n = <U extends Unit>(q: Quantity<U>, unit: U, min: number, max: number) => {
    const v = requireKnown(q, unit);
    if (!Number.isSafeInteger(v) || v < min || v > max || !q.provenance.length || q.provenance.some(id => { const entry = i.ledger.find(e => e.id === id)?.quantity; return entry?.kind !== "known" || entry.unit !== unit || entry.value !== v; })) throw Error("Invalid gateway bounded quantity/provenance");
    return v;
  };
  if (r.profile !== "exact-route-gateway/1" || !Array.isArray(r.routes) || r.routes.length < 1 || r.routes.length > 16 || new Set(r.routes.map(route => route.id)).size !== r.routes.length || Object.keys(r.demands).length !== 1 || !r.demands.route) throw Error("Invalid gateway route/command budget");
  n(r.maxRequestBytes, "bytes", 0, 1048576); n(r.requestEnvelopeBytes, "bytes", 0, 1048576); n(r.maxInFlight, "count", 1, 10000); micros(requireKnown(i.horizon, "us") + n(r.upstreamTimeout, "us", 1000, 60000000));
  for (const [index, route] of r.routes.entries()) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(route.id) || !gatewayPath(route.path) || !["GET", "POST", "ANY"].includes(route.method) || r.routes.slice(0, index).some(old => old.path === route.path && (old.method === "ANY" || route.method === "ANY" || old.method === route.method)) || !["compute", "load-balancer"].includes(i.resources.find(t => t.id === route.target)?.kind ?? "") || !i.paths.some(p => p.source === r.id && p.target === route.target)) throw Error("Invalid gateway route match/upstream path");
    n(route.burst, "count", 1, 10000); n(route.refillEvery, "us", 100, 1000000);
  }
}
