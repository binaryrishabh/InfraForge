import type { CommandConfig } from "../messaging/contracts";
import type { Quantity } from "../../reality/quantity";
export interface GatewayConfig extends CommandConfig {
  id: string; kind: "api-gateway"; profile: "exact-route-gateway/1";
  maxRequestBytes: Quantity<"bytes">;
  requestEnvelopeBytes: Quantity<"bytes">;
  maxInFlight: Quantity<"count">;
  upstreamTimeout: Quantity<"us">;
  routes: Array<{ id: string; target: string; path: string; method: "GET" | "POST" | "ANY"; burst: Quantity<"count">; refillEvery: Quantity<"us"> }>;
}
export interface GatewayRequest { kind: "gateway-request"; path: string; method: "GET" | "POST" }
export interface GatewayReply { ok: boolean; status: 200 | 400 | 404 | 429 | 502 | 503 | 504; reason: string; route?: string; upstream?: unknown }
