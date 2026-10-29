import type { Quantity } from "../../reality/quantity";
import type { AsyncInput, CommandConfig } from "../async/contracts";

export interface AddressRecord { name: string; type: "A"; addresses: string[]; ttl: Quantity<"us">; generation: number }
export interface AuthorityConfig extends CommandConfig { id: string; kind: "dns-authority"; records: AddressRecord[]; negativeTtl: Quantity<"us"> }
export interface ResolverConfig extends CommandConfig { id: string; kind: "dns-resolver"; authority: string; cacheEntries: Quantity<"count"> }
export interface CdnConfig extends CommandConfig { id: string; kind: "cdn"; origin: string; namespace: string; keys: Record<string, string>; capacity: Quantity<"bytes">; ttl: Quantity<"us">; coalesce: boolean; maxWaiters: Quantity<"count"> }
export interface BlobDescriptor { digest: string; bytes: number }
export interface Manifest { digest: string; bytes: number; layers: BlobDescriptor[] }
export interface RegistryConfig extends CommandConfig { id: string; kind: "registry"; store: string; namespace: string }
export interface StartupConfig extends CommandConfig {
  id: string; kind: "artifact-client"; registry: string; cacheBytes: Quantity<"bytes">;
  attempts: Quantity<"count">; backoff: Quantity<"us">;
  initialLayers?: Array<{ digest: string; bytes: Quantity<"bytes"> }>;
  replicas: Array<{ id: string; target: string; reference: string; at: Quantity<"us"> }>;
}
export interface MonitorConfig extends CommandConfig {
  id: string; kind: "monitor"; targets: string[]; backend: string; operation: string;
  interval: Quantity<"us">; exportInterval: Quantity<"us">; freshFor: Quantity<"us">;
  sampleBytes: Quantity<"bytes">; bufferBytes: Quantity<"bytes">; bufferSamples: Quantity<"count">;
  batchSamples: Quantity<"count">; attempts: Quantity<"count">;
}
export interface TelemetryConfig extends CommandConfig { id: string; kind: "telemetry-backend"; samples: Quantity<"count"> }
export type SystemResource = AuthorityConfig | ResolverConfig | CdnConfig | RegistryConfig | StartupConfig | MonitorConfig | TelemetryConfig;
export interface Scope { kind: "any" | "identity" | "zone" | "cidr"; value?: string }
export interface FirewallRule { id: string; direction: "ingress" | "egress"; protocol: "tcp"; source: Scope; destination: Scope; fromPort: Quantity<"count">; toPort: Quantity<"count">; priority: Quantity<"count">; action: "allow" | "deny" }
export interface FirewallConfig { id: string; profile: "ordered-stateful/1"; default: "allow" | "deny"; maxFlows: Quantity<"count">; rules: FirewallRule[] }
export interface Listener { resource: string; protocol: "tcp"; port: Quantity<"count">; tls: "plaintext" | "required" | "optional"; certificate?: { names: string[]; issuer: string; notBefore: Quantity<"us">; notAfter: Quantity<"us"> } }
export interface DialConfig {
  path: string; port: Quantity<"count">; protocol: "tcp"; firewalls: string[];
  tls: { mode: "plaintext" | "authenticated"; serverName?: string; trustedIssuers: string[] };
  dns?: { name: string; resolver: string; routes: Array<{ address: string; path: string }> };
}
export type SystemIntervention = { id: string; at: Quantity<"us"> } & (
  { kind: "dns-record"; target: string; record: AddressRecord } |
  { kind: "cdn-purge"; target: string; key?: string } |
  { kind: "firewall-rules"; target: string; rules: FirewallRule[] });
export interface SystemsInput extends Omit<AsyncInput, "workloadVersion" | "resources"> {
  securityProfile?: "canvas-security/1";
  workloadVersion: "m2g/1"; resources: Array<AsyncInput["resources"][number] | SystemResource>;
  systems: { operation: string; identities: Array<{ id: string; zone: "external" | "internal"; address: string }>; listeners: Listener[]; firewalls: FirewallConfig[]; connections: DialConfig[]; instrumentation: Array<{ target: string; bytes: Quantity<"bytes"> }>; interventions: SystemIntervention[]; commands: Array<{ id: string; at: Quantity<"us">; source: string; target: string; operation: string; request: unknown; bodyBytes: Quantity<"bytes">; provenance: string }> };
}
export interface DnsReply { ok: boolean; reason?: string; name: string; addresses?: string[]; generation?: number; authority: string; expiresAt?: number }
export interface SystemReply { ok: boolean; reason?: string; bytes?: number; content?: string; generation?: number; manifest?: Manifest; reused?: boolean }
export interface Telemetry { id: string; target: string; measurementAt: number; collectedAt: number; bytes: number; values: unknown }
