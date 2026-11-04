import type { EventKernel } from "../time";
import { requireKnown } from "../../reality/quantity";
import type { FirewallConfig } from "./contracts";
import type { eventRows } from "./policy";

export interface Flow { source: string; target: string; port: number; at: number }
/** One cancellable expiry per live entry; activity never accumulates timer tombstones. */
export function firewallState(config: FirewallConfig, flows: Map<string, Flow>, kernel: EventKernel, events: ReturnType<typeof eventRows>) {
  const timers = new Map<string, () => boolean>();
  const counts = { expired: 0, capacityRefused: 0, establishedRequests: 0, newRequests: 0, expiredReturns: 0 };
  return {
    counts,
    touch(id: string) {
      const flow = flows.get(id); if (!flow) return;
      timers.get(id)?.(); flow.at = kernel.now;
      // Expiry (-2), policy restoration (-1), failure/update (0), timeout (1), traffic (2+).
      timers.set(id, kernel.schedule(kernel.now + requireKnown(config.statePolicy!.idleTimeout, "us"), -2, JSON.stringify(["firewall-idle", config.id, id]), () => {
        timers.delete(id); if (flows.delete(id)) { counts.expired++; events.add(kernel.now, "flow-expired", id, config.id); }
      }));
    },
    close(id: string) { timers.get(id)?.(); timers.delete(id); },
  };
}
