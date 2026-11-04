import { apiGatewayError, resolveApiGateway, defaultApiRoutes, type ApiRoute, type Resource, type ConnectionLine } from "@infraforge/domain/resource";
import { requireKnown, type Quantity, type Unit } from "../../reality/quantity";
import type { CommandConfig } from "../messaging/contracts";
import type { SystemsInput } from "../systems/contracts";
import type { GatewayConfig } from "./contracts";
export const API_GATEWAY_PROFILE = "api-gateway/1" as const;
export const gatewayIntent = (resources: readonly Resource[]) => resources.some(r => r.type === "API Gateway" || r.apiGateway !== undefined);
export function gatewayRoutes(r: Resource, connections: readonly ConnectionLine[]): ApiRoute[] {
  if (r.apiGateway?.routes) return r.apiGateway.routes;
  const edges = connections.filter(e => e.sourceId === r.id).sort((a, b) => a.id < b.id ? -1 : 1);
  if (!edges[0]) throw Error("Connect API Gateway to an upstream VM or load balancer");
  return defaultApiRoutes(edges);
}
type Q = <U extends Unit>(id: string, value: number, unit: U, sentence?: string, authored?: boolean) => Quantity<U>;
export function gatewayTemplate(r: Resource, connections: readonly ConnectionLine[], command: CommandConfig, q: Q, requestEnvelopeBytes: Quantity<"bytes">): Omit<GatewayConfig, "id"> {
  const settings = resolveApiGateway(r.apiGateway);
  return { ...command, kind: "api-gateway", profile: "exact-route-gateway/1", requestEnvelopeBytes, maxRequestBytes: q(`${r.id}.apiGateway.maxRequestBytes`, settings.maxRequestBytes, "bytes", "Logical request envelope plus body byte validation limit.", r.apiGateway?.maxRequestBytes !== undefined), maxInFlight: q(`${r.id}.apiGateway.maxInFlight`, settings.maxInFlight, "count", "Maximum gateway-owned requests including upstream waits.", r.apiGateway?.maxInFlight !== undefined), upstreamTimeout: q(`${r.id}.apiGateway.upstreamTimeoutMs`, settings.upstreamTimeoutMs * 1000, "us", "Bounded overall gateway request deadline; upstream effects after a timeout can be ambiguous.", r.apiGateway?.upstreamTimeoutMs !== undefined), routes: gatewayRoutes(r, connections).map(route => {
    const edge = connections.find(e => e.id === route.edge && e.sourceId === r.id);
    if (!edge || !["Virtual Machine", "Load Balancer"].includes(edge.targetType)) throw Error("Gateway route needs its outgoing upstream edge");
    return { id: route.id, target: `$${edge.targetId}`, path: route.path, method: route.method, burst: q(`${r.id}.apiGateway.${route.id}.burst`, route.burstRequests ?? 100, "count", "Independent route burst credits; failures never refund a spent credit.", route.burstRequests !== undefined), refillEvery: q(`${r.id}.apiGateway.${route.id}.refillEvery`, Math.ceil(1000000 / (route.requestsPerSecond ?? 1000)), "us", "One shared-mechanism token per rounded-up microsecond period; no provider rate guarantee.", route.requestsPerSecond !== undefined) };
  }) };
}
export function validateGatewayBindings(resources: readonly Resource[], connections: readonly ConnectionLine[], input: SystemsInput) {
  for (const r of resources) {
    const error = apiGatewayError(r.type, r.apiGateway); if (error) throw Error(error);
    if (r.type !== "API Gateway") continue;
    const runtime = input.resources.find(s => s.id === r.id), settings = resolveApiGateway(r.apiGateway);
    if (runtime?.kind !== "api-gateway" || requireKnown(runtime.maxRequestBytes, "bytes") !== settings.maxRequestBytes || requireKnown(runtime.maxInFlight, "count") !== settings.maxInFlight || requireKnown(runtime.upstreamTimeout, "us") !== settings.upstreamTimeoutMs * 1000) throw Error("Gateway runtime policy must match saved intent");
    if (input.paths.filter(p => p.target === r.id).some(p => Object.values(p.bytes).some(b => requireKnown(b.request, "bytes") !== requireKnown(runtime.requestEnvelopeBytes, "bytes")))) throw Error("Gateway request validation must include its actual transport envelope");
    const expected = gatewayRoutes(r, connections).map(route => ({ id: route.id, target: connections.find(e => e.id === route.edge && e.sourceId === r.id)?.targetId, path: route.path, method: route.method, burst: route.burstRequests ?? 100, refillEvery: Math.ceil(1000000 / (route.requestsPerSecond ?? 1000)) }));
    const actual = runtime.routes.map(route => ({ id: route.id, target: route.target, path: route.path, method: route.method, burst: requireKnown(route.burst, "count"), refillEvery: requireKnown(route.refillEvery, "us") }));
    if (JSON.stringify(expected) !== JSON.stringify(actual) || connections.filter(e => e.sourceId === r.id).some(e => !expected.some(route => route.target === e.targetId))) throw Error("Gateway routes and budgets must match saved edges and intent");
  }
}
