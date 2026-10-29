export const FLOW_OPERATIONS = ["read", "write"] as const;
export type FlowOperation = typeof FLOW_OPERATIONS[number];
export interface FlowCall { id: string; kind: "call"; edge: string; operation?: FlowOperation }
export type FlowStep = { id: string; kind: "compute" } | FlowCall | {
  id: string; kind: "parallel"; branches: FlowCall[]; wait: "all" | number;
};
export interface ApplicationFlow {
  schema: "application-flow/1";
  operations: Partial<Record<FlowOperation, { steps: FlowStep[] }>>;
}
/** Shared structural validator. Connectivity, profiles and effect safety belong to compilation. */
export function applicationFlowError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
  const id = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
  if (type !== "Virtual Machine") return "Application flows require a Virtual Machine.";
  if (!object(value) || !keys(value, ["schema", "operations"]) || value.schema !== "application-flow/1" || !object(value.operations)) return "Expected application-flow/1 operations.";
  if (!Object.keys(value.operations).length || !keys(value.operations, [...FLOW_OPERATIONS])) return "Choose read or write for each flow.";
  for (const [operation, flow] of Object.entries(value.operations)) {
    if (!object(flow) || !keys(flow, ["steps"]) || !Array.isArray(flow.steps) || !flow.steps.length || flow.steps.length > 32) return `${operation}: use 1–32 ordered steps.`;
    const ids = new Set<unknown>();
    const unique = (v: unknown) => id(v) && !ids.has(v) && !!ids.add(v);
    const call = (v: unknown): boolean => object(v) && keys(v, ["id", "kind", "edge", "operation"]) && unique(v.id) && v.kind === "call" && typeof v.edge === "string" && v.edge.length > 0 && v.edge.length <= 256 && (v.operation === undefined || FLOW_OPERATIONS.includes(v.operation as FlowOperation));
    for (const step of flow.steps) {
      if (!object(step)) return `${operation}: invalid step.`;
      if (step.kind === "call") { if (!call(step)) return `${operation}: calls need unique IDs and a connected edge.`; }
      else if (step.kind === "compute") { if (!keys(step, ["id", "kind"]) || !unique(step.id)) return `${operation}: compute takes no parameters and needs a unique ID.`; }
      else if (step.kind === "parallel") {
        if (!keys(step, ["id", "kind", "branches", "wait"]) || !unique(step.id) || !Array.isArray(step.branches) || step.branches.length < 2 || step.branches.length > 8) return `${operation}: parallel needs 2–8 single-call branches and a unique ID.`;
        if (step.branches.some(b => !call(b))) return `${operation}: each branch must be exactly one call with a unique ID; compute and nested flows are unsupported.`;
        if (step.wait !== "all" && (!Number.isSafeInteger(step.wait) || Number(step.wait) < 1 || Number(step.wait) > step.branches.length)) return `${operation}: join threshold must be 1 through the branch count.`;
      } else return `${operation}: unsupported step; use compute, call or parallel.`;
    }
  }
}
