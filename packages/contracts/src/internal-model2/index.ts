export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface NumericField { key: string; label: string; unit: string; min: number; max: number; integer?: boolean }
export const authoringGroups: { title: string; fields: NumericField[] }[] = [
  { title: "Recorded workload and timeline", fields: [
    { key: "horizon", label: "Horizon", unit: "us", min: 1, max: 1000000, integer: true },
    { key: "sample", label: "Sample interval", unit: "us", min: 1, max: 1000000, integer: true },
    { key: "start", label: "Arrival start", unit: "us", min: 0, max: 1000000, integer: true },
    { key: "rate", label: "Steady arrival rate", unit: "requests/minute", min: 0.001, max: 100000000 },
    { key: "readRatio", label: "Read fraction", unit: "ratio", min: 0, max: 1 },
    { key: "payload", label: "Application payload", unit: "bytes", min: 0, max: 1000000, integer: true },
  ] },
  { title: "Application and VM", fields: [
    { key: "readCpu", label: "Read CPU demand", unit: "cpu-us", min: 1, max: 1000000 },
    { key: "writeCpu", label: "Write CPU demand", unit: "cpu-us", min: 1, max: 1000000 },
    { key: "appWait", label: "Application blocking wait", unit: "us", min: 0, max: 1000000 },
    { key: "cores", label: "VM cores", unit: "cores", min: 1, max: 64, integer: true },
    { key: "workers", label: "VM workers", unit: "count", min: 1, max: 256, integer: true },
    { key: "queue", label: "VM pending capacity", unit: "count", min: 0, max: 256, integer: true },
    { key: "parallel", label: "CPU parallelism per operation", unit: "cores", min: 1, max: 64, integer: true },
    { key: "callerTimeout", label: "Caller timeout", unit: "us", min: 1, max: 1000000 },
  ] },
  { title: "Atomic current-object store", fields: [
    { key: "capacity", label: "Current-object capacity", unit: "bytes", min: 1, max: 1000000000, integer: true },
    { key: "objectCpu", label: "CPU per object command", unit: "cpu-us", min: 1, max: 1000000 },
    { key: "objectWait", label: "Object command blocking wait", unit: "us", min: 0, max: 1000000 },
    { key: "objectConcurrency", label: "Object concurrency", unit: "count", min: 1, max: 256, integer: true },
    { key: "objectQueue", label: "Object pending capacity", unit: "count", min: 0, max: 256, integer: true },
    { key: "objectTimeout", label: "Object command timeout", unit: "us", min: 1, max: 1000000 },
  ] },
  { title: "Directed transport and connection pool", fields: [
    { key: "port", label: "TCP listener port", unit: "port", min: 1, max: 65535, integer: true },
    { key: "bandwidth", label: "Bandwidth per directed link", unit: "bytes/s", min: 1, max: 1000000000 },
    { key: "propagation", label: "Propagation per directed link", unit: "us", min: 0, max: 1000000 },
    { key: "buffer", label: "Link buffer", unit: "bytes", min: 0, max: 1000000, integer: true },
    { key: "connections", label: "Pool connections", unit: "count", min: 1, max: 256, integer: true },
    { key: "streams", label: "Streams per connection", unit: "count", min: 1, max: 256, integer: true },
    { key: "poolQueue", label: "Pool pending capacity", unit: "count", min: 0, max: 256, integer: true },
    { key: "establish", label: "Connection establishment", unit: "us", min: 0, max: 1000000 },
    { key: "acquire", label: "Pool acquisition timeout", unit: "us", min: 1, max: 1000000 },
    { key: "connect", label: "Connect timeout", unit: "us", min: 1, max: 1000000 },
    { key: "response", label: "Response timeout", unit: "us", min: 1, max: 1000000 },
    { key: "requestBytes", label: "Protocol request envelope", unit: "bytes", min: 0, max: 1000000, integer: true },
    { key: "responseBytes", label: "Protocol response envelope", unit: "bytes", min: 0, max: 1000000, integer: true },
  ] },
  { title: "Software evidence budgets", fields: [
    { key: "maxEvents", label: "Maximum events", unit: "count", min: 1, max: 10000, integer: true },
    { key: "maxRequests", label: "Maximum requests", unit: "count", min: 1, max: 256, integer: true },
    { key: "maxSamples", label: "Maximum samples", unit: "count", min: 1, max: 64, integer: true },
    { key: "maxTraceRows", label: "Maximum trace rows", unit: "count", min: 1, max: 256, integer: true },
    { key: "maxRawResults", label: "Maximum raw results", unit: "count", min: 1, max: 256, integer: true },
  ] },
];
export interface AuthoredCommand { at: string; kind: "put" | "get" | "head" | "delete"; namespace: string; key: string; bytes: string; content: string }
export interface AuthoringDraft {
  schema: "infraforge-authoring/1"; origin: string; values: Record<string, string>;
  vmAddress: string; objectAddress: string; callerAddress: string; zone: string;
  security: "" | "plaintext-reviewed"; commands: AuthoredCommand[];
  crash: boolean; crashAt: string; crashDuration: string; restart: string;
}
export interface AuthoringRequest { infrastructureId: string; expectedDesignUpdatedAt: string; idempotencyKey: string; authoring: AuthoringDraft }
export interface AdmissionRequest { infrastructureId: string; expectedDesignUpdatedAt: string; idempotencyKey: string; workload: Json; contract: Json }
// Machine-authored operator contract. The guided object workspace remains v1.
export interface ConnectedAdmissionRequest extends AdmissionRequest { execution: "infraforge-internal-execution/2"; causal: { events: number; identities: number; textCharacters: number } }
export interface Diagnostic { code: string; path: string; message: string; severity?: string }
export interface InternalDesign { id: string; name: string; updatedAt: string; supported: boolean; reasons: string[]; vm?: string; objects?: string; connection?: string; port?: number }
export interface Review { request: AdmissionRequest; requestHash: string; revision: string; designName: string; fields: { field: string; value: number; unit: string; origin: string }[]; assumptions: string[]; arrivals: number }
export interface RunSummary { id: string; status: string; inputHash: string; sequence: number; throughUs: number; reason: string | null; createdAt: string;
  lesson?: { phase: "before" | "during" | "after" | "Unknown"; profile: string } }
export interface InternalReport { id: string; status: string; reason: string | null; inputHash: string; source: string | null; sequence: number; throughUs: number; inputValid: boolean; problems: string[];
  replay: { compatible: boolean; reason: string }; observed: [string, Json][]; interpreted: [string, Json][]; unknown: string[]; state: Json; checkpoints: Json[]; usage: Json;
  lesson?: { profile: string; phase: string; kind: "Observed" | "Unknown"; readOutcome: string; returnedBytes: number | null; explanation: string; limits: string[] } }
export interface ReplayResult { kind: string; complete?: boolean; expected?: string; actual?: string; reason?: string; mutation?: string }
