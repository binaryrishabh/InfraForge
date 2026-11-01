import { vmDesign, prepareVm } from "./vmExecution.fixture";
import { keyspaceDesign } from "./keyspace.fixture";

export const quotaModes = ["plain", "lb", "data", "autoscaled", "flow", "execution"] as const;
export function quotaDesign(mode: typeof quotaModes[number] = "plain") {
  if (mode === "data") return keyspaceDesign();
  const d = vmDesign(mode === "autoscaled" || mode === "flow" ? mode : "plain");
  if (mode === "lb") {
    d.resources.unshift({ id: "lb", type: "Load Balancer", x: 0, y: 0 });
    d.connections.push({ id: "lb-app", sourceId: "lb", sourceType: "Load Balancer", targetId: "app", targetType: "Virtual Machine", port: 80 });
  }
  if (mode === "execution") d.resources[0]!.vmExecution = { version: 1, workers: 2, queuedRequests: 3 };
  return d;
}
export const prepareQuota = prepareVm;
