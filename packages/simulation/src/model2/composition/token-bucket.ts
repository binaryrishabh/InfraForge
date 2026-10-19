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
  const integer = (value: number, minimum: number) => { if (!Number.isSafeInteger(value) || value < minimum) throw Error("Invalid token bucket quantity"); return value; };
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
      let tokens = requireKnown(config.initial, "count"), anchor = host.clock.now as number, retained = 0, received = 0, admitted = 0, rejected = 0, bypassed = 0;
      const project = () => {
        const steps = Math.floor((host.clock.now - anchor) / period), room = capacity - tokens;
        // Bound multiplication before performing it, even at a safe-integer
        // horizon with a very large configured refill amount.
        const added = steps >= Math.ceil(room / refill) ? room : steps * refill;
        return { at: anchor + steps * period, added, retained: integer(retained + added, 0) };
      };
      return {
        receive(target: string, work: Invocation, done: (outcome: RemoteOutcome) => void, next: () => Receipt): Receipt {
          if (target !== config.scope.target || (config.scope.operation !== undefined && work.operation !== config.scope.operation)) { bypassed = integer(bypassed + 1, 0); return next(); }
          const projected = project(); anchor = projected.at; retained = projected.retained; tokens += projected.added;
          received = integer(received + 1, 0);
          if (tokens < 1) {
            rejected = integer(rejected + 1, 0); done("rejected");
            return { admitted: false, state: () => "finished", cancel: () => "already-finished" };
          }
          tokens--; admitted = integer(admitted + 1, 0); return next();
        },
        measure(): RequestTokenBucketState {
          const projected = project();
          return { configuration: JSON.parse(JSON.stringify(config)), policy: "discrete-request-token-bucket/1", received, admitted, rejected, bypassed, tokens: tokens + projected.added, retainedRefillTokens: projected.retained };
        },
      };
    },
  } satisfies RequestPlugin;
}
