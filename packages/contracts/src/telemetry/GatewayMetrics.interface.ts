export interface GatewayMetrics {
  version: 1;
  received: number; admitted: number; completed: number; invalid: number; missingRoute: number; throttled: number; overloaded: number;
  gatewayFailed: number; upstreamFailed: number; timedOut: number; cancelled: number; pending: number;
  routes: Array<{ id: string; target: string; path: string; method: string; received: number; admitted: number; rejected: number; tokens: number; capacity: number }>;
}
