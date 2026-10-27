import type { Resource, ConnectionLine } from "@infraforge/domain/resource";
import type { WorkloadProfile } from "@infraforge/domain/workload";
import type { Quantity } from "../../reality/quantity";
import type { RealityEntry } from "../../reality/ledger";
import type { ComputeProfile, ComputeResource } from "../compute/contracts";
import type { SystemsInput, Listener, FirewallConfig, DialConfig, StartupConfig } from "../systems/contracts";
import type { LinkConfig, PathConfig } from "../network/contracts";
import type { OperationClass } from "../workload/contracts";
export const COMPILER_VERSION = "infraforge-product-compiler/1";
export interface SavedProductDesign { schema: "infraforge-saved-design/1"; resources: Resource[]; connections: ConnectionLine[]; workload: WorkloadProfile }
export interface ApplicationProfile {
  schema: "infraforge-application/1"; id: string; version: string; provenance: string[]; validityDomain: string;
  operations: Array<Omit<OperationClass, "entry">>;
  demands: SystemsInput["profiles"];
  controlOperation: string;
  // The binding selects an operation mixture, never database query demand.
  readOperation: string; writeOperation: string;
  payloads: Record<WorkloadProfile["payloadSize"], Quantity<"bytes">>;
}
type RuntimeResource = SystemsInput["resources"][number];
export type ResourceTemplate = RuntimeResource extends infer R ? R extends RuntimeResource ? Omit<R, "id"> : never : never;
export interface NodeContract {
  type: Resource["type"]; profileVersion: string; provenance: string[];
  resources: Array<{ role: string; config: ResourceTemplate }>;
  // $self resolves to the primary resource; $node/role resolves a declared auxiliary.
  primary: string; listeners: Array<Omit<Listener, "resource"> & { role: string }>;
  identities: Array<{ role: string; address: string; zone: "internal" | "external" }>;
  securityReplacement: "explicit-reviewed/1";
  firewall?: Omit<FirewallConfig, "id">;
  internalEdges: Array<EdgeContract & { id: string }>;
  controller?: ControllerProfile;
}
export type EdgePurpose = "dependency" | "routing" | "origin" | "dns-query" | "artifact" | "monitor-target" | "telemetry-export" | "consumer" | "policy-attachment";
export interface TransportProfile {
  version: string; provenance: string[];
  ownership: "per-path" | "shared";
  // Explicit shared directed links: drawing edges do not manufacture bandwidth.
  links: LinkConfig[];
  pool: PathConfig["pool"]; bytes: PathConfig["bytes"];
}
export interface EdgeContract {
  purpose: EdgePurpose; sourceRole: string; targetRole: string;
  transport?: string; request?: string[]; response?: string[];
  security?: Omit<DialConfig, "path">;
}
export interface ControllerProfile {
  schema: "generic-reconcile/1"; version: string; provenance: string[];
  loadBalancer: string; initial: Quantity<"count">; min: Quantity<"count">; max: Quantity<"count">;
  // Explicit warm start for an already deployed canvas; new replicas still provision normally.
  initialReady?: boolean;
  // Finite predeclared station slots are dormant, not capacity. Identities are created on provision.
  slots: Quantity<"count">; interval: Quantity<"us">; target: Quantity<"ratio">; tolerance: Quantity<"ratio">;
  cooldown: Quantity<"us">; downStabilization: Quantity<"us">; provision: Quantity<"us">; startup: Quantity<"us">;
  drain: Quantity<"us">; attempts: Quantity<"count">; retry: Quantity<"us">;
  signal: { kind: "direct-core-time" } | { kind: "observed-core-time"; backend: string; freshFor: Quantity<"us">; stale: "hold" };
  artifact: { node: string; role: string; reference: string };
  provisionFailures: number[];
  manual: Array<{ id: string; at: Quantity<"us">; desired: Quantity<"count"> }>;
}
export interface ProductContract {
  schema: "infraforge-product-model2/1"; version: string; designVersion: string; catalogVersion: string; workloadVersion: "product-arrivals/1";
  application?: ApplicationProfile; ledger: RealityEntry[]; nodes: Record<string, NodeContract>;
  edges: Record<string, EdgeContract>; transports: Record<string, TransportProfile>;
  caller: { address: string; entry: string; transport: string; request: string[]; response: string[]; security: Omit<DialConfig, "path">; dependencies: Array<Omit<EdgeContract, "sourceRole" | "targetRole"> & { id: string; target: string }> };
  seed: string; horizon: Quantity<"us">; sampleInterval: Quantity<"us">;
  arrival: { start: Quantity<"us">; peak?: { start: Quantity<"us">; end: Quantity<"us"> } };
  limits: SystemsInput["limits"];
  instrumentation: SystemsInput["systems"]["instrumentation"];
  commands: SystemsInput["systems"]["commands"];
  faults: ProductFault[];
  capabilities: Array<{ resource: string; sku: string; catalogVersion: string; field: "vCpu" | "memoryGb"; value: Quantity; fact: string }>;
}
export interface ProductFault { id: string; kind: "Crash" | "CpuSpike" | "MemoryLeak" | "NetworkDelay" | "DiskFailure"; target: string; at: Quantity<"us">; duration: Quantity<"us">; restart?: Quantity<"us">; scope?: string[]; cpu?: Quantity<"cpu-us">; parallelism?: Quantity<"cores">; delay?: Quantity<"us">; profile?: "retain-logical-state/1" }
export interface Diagnostic { code: string; path: string; message: string; severity: "error" | "warning" }
export interface SemanticSpec { schema: "infraforge-semantic-infrastructure/1"; versions: { design: string; compiler: string; model: "2"; application: string; catalog: string; workload: string; contract: string }; nodes: Array<{ id: string; type: Resource["type"]; owner: string; profile: string }>; edges: Array<{ id: string; source: string; target: string; purpose: EdgePurpose }>; capabilities: Array<ProductContract["capabilities"][number] & { scope: string }>; unknown: string[]; legacyMetadata: Array<{ id: string; region?: string; public?: boolean; encryption?: boolean; openPorts?: number[] }>; numericOrigins: Array<{ path: string; origin: "user-authored" | "application-profile" | "provider-fact" | "derived" | "policy" | "Unknown"; sources: string[] }> }
export interface CompiledPool { id: string; replicas: string[]; profile: ControllerProfile; artifactClients: Array<{ id: string; replica: string }> }
export interface CompiledProduct { schema: "infraforge-compiled-product/1"; semantic: SemanticSpec; input: SystemsInput; pools: CompiledPool[]; crashes: Array<{ target: string; at: Quantity<"us">; restartAt: Quantity<"us"> }> }
export type CompileResult = { ok: true; value: CompiledProduct; diagnostics: Diagnostic[] } | { ok: false; diagnostics: Diagnostic[]; semantic?: SemanticSpec };
export type ExecutionTemplate = Omit<ComputeResource, "id">;
export type ApplicationDemand = ComputeProfile;
export type ArtifactTemplate = Omit<StartupConfig, "id" | "replicas">;
