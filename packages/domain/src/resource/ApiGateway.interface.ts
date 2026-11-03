export interface ApiRoute {
  id: string; edge: string; path: string; method: "GET" | "POST" | "ANY";
  burstRequests?: number; requestsPerSecond?: number;
}
export interface ApiGatewaySettings {
  version: 1;
  maxRequestBytes?: number;
  maxInFlight?: number;
  upstreamTimeoutMs?: number;
  routes?: ApiRoute[];
}
export const resolveApiGateway = (s?: ApiGatewaySettings) => ({ maxRequestBytes: s?.maxRequestBytes ?? 1048576, maxInFlight: s?.maxInFlight ?? 256, upstreamTimeoutMs: s?.upstreamTimeoutMs ?? 1000 });
export const gatewayPath = (value: unknown): value is string => typeof value === "string" && value.length <= 256 && /^\/[a-zA-Z0-9/_-]*$/.test(value);
export function apiGatewayError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const integer = (v: unknown, min: number, max: number) => v === undefined || (typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max);
  if (type !== "API Gateway" || !object(value) || value.version !== 1 || Object.keys(value).some(k => !["version", "maxRequestBytes", "maxInFlight", "upstreamTimeoutMs", "routes"].includes(k)) || !integer(value.maxRequestBytes, 0, 1048576) || !integer(value.maxInFlight, 1, 10000) || !integer(value.upstreamTimeoutMs, 1, 60000)) return "API Gateway requires owned bounded version 1 settings.";
  if (value.routes !== undefined) {
    if (!Array.isArray(value.routes) || value.routes.length < 1 || value.routes.length > 16) return "API Gateway supports 1 to 16 exact routes.";
    const ids = new Set(), matches: Array<{ path: string; method: string }> = [];
    for (const r of value.routes) {
      if (!object(r) || typeof r.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(r.id) || typeof r.edge !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(r.edge) || !gatewayPath(r.path) || !["GET", "POST", "ANY"].includes(String(r.method)) || ids.has(r.id) || matches.some(m => m.path === r.path && (m.method === "ANY" || r.method === "ANY" || m.method === r.method)) || Object.keys(r).some(k => !["id", "edge", "path", "method", "burstRequests", "requestsPerSecond"].includes(k)) || !integer(r.burstRequests, 1, 10000) || !integer(r.requestsPerSecond, 1, 10000)) return "Gateway routes require unique exact matches, connected edges and bounded rate budgets.";
      ids.add(r.id); matches.push({ path: r.path, method: String(r.method) });
    }
  }
}
