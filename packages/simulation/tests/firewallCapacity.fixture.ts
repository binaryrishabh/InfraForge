import { securityDesign, prepareSecurity } from "./securityCanvas.fixture";
import { quantities } from "./workloadFixture";
import { createProductModel2 } from "../src/model2/product/run";

export const firewallModes = ["front", "update", "tls", "reuse", "two"] as const;
export function firewallDesign(mode: typeof firewallModes[number] = "front", maxFlows?: number) {
  const saved = mode === "two"
    ? securityDesign({ lb: "Load Balancer", app: "Virtual Machine", firewall: "Firewall", second: "Firewall" }, [["lb", "app"], ["firewall", "lb"], ["second", "app"]])
    : securityDesign({ lb: "Load Balancer", app: "Virtual Machine", firewall: "Firewall" }, [["lb", "app"], ["firewall", "lb"]]);
  saved.resources.find(r => r.id === "firewall")!.firewallSettings = { version: 1, default: "allow", rules: [] };
  if (maxFlows !== undefined) Object.assign(saved.resources.find(r => r.id === "firewall")!, { firewallCapacity: { version: 1, maxFlows } });
  return saved;
}
export function firewallSetup(mode: typeof firewallModes[number] = "front", maxFlows?: number, reuse = mode === "reuse") {
  const saved = firewallDesign(mode, maxFlows), adapted = prepareSecurity(saved), input = adapted.compiled.input, q = quantities();
  for (const path of input.paths) path.pool = { ...path.pool, reuse };
  if (mode === "update") {
    input.systems.interventions.push({ id: "block-new", kind: "firewall-rules", target: "firewall", at: q.q("firewall.test.update", 50000, "us"), rules: [denyNew(q)] });
  }
  if (mode === "tls") {
    const listener = input.systems.listeners.find(l => l.resource === "lb")!;
    listener.tls = "required";
    listener.certificate = { names: ["app.example"], issuer: "test-ca", notBefore: q.q("firewall.test.cert.start", 0, "us"), notAfter: q.q("firewall.test.cert.end", 120000000, "us") };
    input.systems.connections.find(c => c.path === "external-entry")!.tls = { mode: "authenticated", serverName: "app.example", trustedIssuers: ["test-ca"] };
  }
  input.ledger.push(...q.ledger);
  return { saved, ...adapted, runtime: createProductModel2(adapted.compiled) };
}
export function denyNew(q: ReturnType<typeof quantities>) {
  return { id: "deny-new", action: "deny" as const, direction: "ingress" as const, protocol: "tcp" as const, source: { kind: "any" as const }, destination: { kind: "any" as const }, priority: q.q("firewall.test.priority", 0, "count"), fromPort: q.q("firewall.test.from", 1, "count"), toPort: q.q("firewall.test.to", 65535, "count") };
}
