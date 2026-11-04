import { firewallDesign, denyNew } from "./firewallCapacity.fixture";
import { prepareSecurity } from "./securityCanvas.fixture";
import { quantities } from "./workloadFixture";
import { createProductModel2 } from "../src/model2/product/run";

export function depthSetup(idleTimeoutSeconds = 1, maxFlows = 1) {
  const saved = firewallDesign("reuse", maxFlows);
  saved.resources.find(r => r.id === "firewall")!.firewallState = { version: 1, idleTimeoutSeconds };
  return { saved, ...prepareSecurity(saved) };
}
export function gapRun(idleTimeoutSeconds: number) {
  const f = depthSetup(idleTimeoutSeconds), input = f.compiled.input, q = quantities();
  input.arrivals = input.arrivals.filter(a => a.kind === "trace" && a.trace.rows.some(r => r.operation === "read")).slice(0, 1);
  for (const a of input.arrivals) if (a.kind === "trace") a.trace.rows = [0, 2000000, 2100000, 4000000, 4100000].map((at, i) => ({ ...a.trace.rows[0]!, id: `gap-${i}`, atUs: at }));
  input.systems.interventions.push({ id: "deny", kind: "firewall-rules", target: "firewall", at: q.q("gap.deny", 500000, "us"), rules: [denyNew(q)] }, { id: "restore", kind: "firewall-rules", target: "firewall", at: q.q("gap.restore", 3000000, "us"), rules: [], restore: true });
  input.ledger.push(...q.ledger);
  return { ...f, runtime: createProductModel2(f.compiled) };
}
