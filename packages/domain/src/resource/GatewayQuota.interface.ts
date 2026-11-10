import type { ApiGatewaySettings } from "./ApiGateway.interface";

/** Equal authored route budgets, owned either once by the gateway or once per route. */
export interface GatewayQuota { version: 1; scope: "shared" | "per-route" }
export function gatewayQuotaError(type: string, value: unknown, gateway?: ApiGatewaySettings): string | undefined {
  if (value === undefined) return;
  if (type !== "API Gateway" || !value || typeof value !== "object" || Array.isArray(value)) return "Quota scope belongs to an API Gateway.";
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !["shared", "per-route"].includes(String(v.scope)) || Object.keys(v).some(k => !["version", "scope"].includes(k))) return "Gateway quota requires strict version 1 scope.";
  const routes = gateway?.routes;
  if (!Array.isArray(routes) || routes.length < 2 || routes.some(r => !r || r.burstRequests === undefined || r.requestsPerSecond === undefined || r.burstRequests !== routes[0]!.burstRequests || r.requestsPerSecond !== routes[0]!.requestsPerSecond)) return "Quota scope requires at least two explicit routes with equal burst and refill budgets.";
}
