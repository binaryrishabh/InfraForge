import { bucketInteger as integer, tokenBucketState, takeToken, projectTokens } from "./token-bucket-core";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { Invocation, Receipt, RemoteOutcome } from "../workload/contracts";
import type { MechanismHost, RequestPlugin } from "./run";
import { manifest } from "./registry";

export interface RequestTokenBucketConfig {
  id: string;
  scope: { target: string; operation?: string };
  capacity: Quantity<"count">;
  initial: Quantity<"count">;
  refill: { tokens: Quantity<"count">; every: Quantity<"us"> };
}
export interface RequestTokenBucketState {
  configuration: RequestTokenBucketConfig;
  policy: "discrete-request-token-bucket/1";
  received: number;
  admitted: number;
  rejected: number;
  bypassed: number;
  tokens: number;
  retainedRefillTokens: number;
}

// One bounded scope, no global identity map and no refill timer. Credits are
// consumed on an admission attempt; downstream failure/cancellation never refunds.
export function requestTokenBucket(authored: RequestTokenBucketConfig) {
  const config: RequestTokenBucketConfig = JSON.parse(JSON.stringify(authored));
  const validate = () => {
    if (!config.id || !config.scope.target || config.id.length > 256 || config.scope.target.length > 256 || (config.scope.operation !== undefined && (!config.scope.operation || config.scope.operation.length > 256))) throw Error("Invalid token bucket scope");
    const capacity = integer(requireKnown(config.capacity, "count"), 1);
    if (integer(requireKnown(config.initial, "count"), 0) > capacity) throw Error("Initial tokens exceed capacity");
    integer(requireKnown(config.refill.tokens, "count"), 1); integer(requireKnown(config.refill.every, "us"), 1);
  };
  return {
    manifest: manifest(config.id, "scoped-request-token-bucket/1"), validate,
    instantiate(host: MechanismHost) {
      validate();
      const capacity = requireKnown(config.capacity, "count"), refill = requireKnown(config.refill.tokens, "count"), period = requireKnown(config.refill.every, "us");
      let state = tokenBucketState(capacity, requireKnown(config.initial, "count"), refill, period, host.clock.now), bypassed = 0;
      return {
        receive(target: string, work: Invocation, done: (outcome: RemoteOutcome) => void, next: () => Receipt): Receipt {
          if (target !== config.scope.target || (config.scope.operation !== undefined && work.operation !== config.scope.operation)) { bypassed = integer(bypassed + 1, 0); return next(); }
          const nextState = takeToken(state, host.clock.now); state = nextState.state;
          if (!nextState.admitted) {
            done("rejected"); return { admitted: false, state: () => "finished", cancel: () => "already-finished" };
          }
          return next();
        },
        measure(): RequestTokenBucketState {
          const projected = projectTokens(state, host.clock.now);
          return { configuration: JSON.parse(JSON.stringify(config)), policy: "discrete-request-token-bucket/1", received: state.received, admitted: state.admitted, rejected: state.rejected, bypassed, tokens: projected.tokens, retainedRefillTokens: projected.retainedRefillTokens };
        },
      };
    },
  } satisfies RequestPlugin;
}
