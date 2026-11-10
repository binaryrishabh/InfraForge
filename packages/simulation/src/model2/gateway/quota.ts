import { tokenBucketState, takeToken, projectTokens } from "../composition/token-bucket-core";
import { requireKnown } from "../../reality/quantity";
import type { GatewayConfig } from "./contracts";
import type { EventKernel } from "../time";

export function validateRuntimeGatewayQuota(r: GatewayConfig) {
  if (r.quota === undefined) return;
  const q = r.quota;
  if (!q || q.profile !== "gateway-quota/1" || !["shared", "per-route"].includes(q.scope) || Object.keys(q).some(k => !["profile", "scope"].includes(k)) || r.routes.length < 2 || r.routes.some(route => requireKnown(route.burst, "count") !== requireKnown(r.routes[0]!.burst, "count") || requireKnown(route.refillEvery, "us") !== requireKnown(r.routes[0]!.refillEvery, "us"))) throw Error("Invalid equal-budget gateway quota");
}

// Route accounting is distinct from shared credit ownership. Refusals and failures
// do not refund tokens; projection never consumes a credit.
export function gatewayQuotaBuckets(config: GatewayConfig, clock: EventKernel) {
  const states = config.routes.map(r => tokenBucketState(requireKnown(r.burst, "count"), requireKnown(r.burst, "count"), 1, requireKnown(r.refillEvery, "us"), clock.now));
  let shared = config.quota?.scope === "shared" ? { ...states[0]! } : undefined;
  return {
    take(index: number) {
      const route = states[index]!;
      const result = takeToken(shared ?? route, clock.now);
      if (shared) {
        shared = result.state;
        route.received++;
        if (result.admitted) route.admitted++; else route.rejected++;
      } else states[index] = result.state;
      return result.admitted;
    },
    reading(index: number) {
      const route = states[index]!;
      return shared ? { ...projectTokens(shared, clock.now), received: route.received, admitted: route.admitted, rejected: route.rejected } : projectTokens(route, clock.now);
    },
  };
}
