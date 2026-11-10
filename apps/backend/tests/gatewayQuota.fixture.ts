import { gatewayLayout } from "./apiGateway.fixture";
export const quotaWorkload = {targetThroughput: 6000, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, peakMultiplier: 1, readWriteRatio: 0.9, payloadSize: "light" as const};
export function quotaLayout(scope: "shared" | "per-route" = "shared") {
  const layout = gatewayLayout(2);
  layout.resources[0]!.gatewayQuota = {version: 1, scope};
  for (const route of layout.resources[0]!.apiGateway!.routes!) {route.burstRequests = 2; route.requestsPerSecond = 10;}
  return layout;
}
