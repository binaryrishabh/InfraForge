import { coalescingBurst } from "./cdnCoalescing.fixture";
import { systemCommand } from "./systemsFixture";
import { quantities } from "./workloadFixture";
import { createSystemsModel2 } from "../src/model2/systems/run";

export function cdnOriginRecovery(coalesce: boolean, maxFlows = 64) {
  const input = coalescingBurst(coalesce, undefined, 1), q = quantities("Authored origin-read outage, recovery burst and shared firewall budget; no provider timing claim");
  input.systems.firewalls[0]!.maxFlows = q.q("recovery.flowCapacity", maxFlows, "count");
  input.asyncInterventions.push({ id: "origin-read-failure", kind: "object-access", target: "objects", reads: false, writes: true, at: q.q("recovery.outageAt", 0, "us"), duration: q.q("recovery.outageDuration", 10000, "us") });
  for (let n = 0; n < 10; n++) {
    systemCommand(input, `recovered-${n}`, 12000, "$caller", "cdn", { kind: "get", key: "asset" });
    systemCommand(input, `warm-${n}`, 25000, "$caller", "cdn", { kind: "get", key: "asset" });
  }
  input.ledger.push(...q.ledger);
  return { input, runtime: createSystemsModel2(input) };
}
