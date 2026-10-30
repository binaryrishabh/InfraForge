import type { ComputeInput } from "./contracts";
import type { RuntimeFlowCall } from "./flow";
export function validateFlows(input: ComputeInput) {
  if (!input.resources.some(r => r.kind === "compute" && r.applicationFlow)) return;
  const resources = new Map(input.resources.map(r => [r.id, r])), operations = new Map(input.operations.map(o => [o.id, o]));
  const safe = (operation: string) => ["read-only", "idempotent"].includes(operations.get(operation)?.idempotency ?? "unknown");
  for (const r of input.resources) if (r.kind === "compute" && r.applicationFlow) {
    if (Object.keys(r.applicationFlow).some(k => !["schema", "operations"].includes(k)) || !["application-flow/1", "application-flow/2", "application-flow/3"].includes(r.applicationFlow.schema) || !Object.keys(r.applicationFlow.operations).length) throw Error("Invalid application flow operations");
    if (r.downstream || r.downstreamByOperation) throw Error("An operation flow cannot coexist with downstream routing");
    for (const [operation, flow] of Object.entries(r.applicationFlow.operations)) {
      if (Object.keys(flow).some(k => k !== "steps") || !operations.has(operation) || !flow.steps.length || flow.steps.length > 32) throw Error("Flow needs a known operation and 1–32 steps");
      const ids = new Set<string>();
      let publishes = 0;
      const unique = (id: string) => { if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ids.has(id)) throw Error("Unique persisted flow step/branch IDs required"); ids.add(id); };
      const call = (c: RuntimeFlowCall, parallel: boolean) => {
        if (c.kind !== "call" || Object.keys(c).some(k => !["kind", "id", "target", "operation"].includes(k))) throw Error("Each branch must be exactly one call; compute/nested branches unsupported");
        unique(c.id);
        const op = c.operation ?? operation;
        if (!resources.has(c.target) || !operations.has(op)) throw Error("Missing flow target/operation");
        if (parallel && !safe(op)) throw Error("Parallel calls must be read-only or idempotent");
        if (safe(operation) && !safe(op)) throw Error("Read-only/idempotent flow cannot call a mutating or unknown operation");
      };
      for (const s of flow.steps) {
        if (s.kind === "call") call(s, false);
        else if (s.kind === "data") {
          unique(s.id);
          if (r.applicationFlow.schema === "application-flow/1" || Object.keys(s).some(k => !["id", "kind", "target", "operation", "command"].includes(k)) || !["query", "cache-aside"].includes(s.command) || !["read", "write"].includes(s.operation) || !resources.has(s.target) || !operations.has(s.operation)) throw Error("Invalid typed data step");
          if (safe(operation) && s.operation === "write") throw Error("Read-only/idempotent flow cannot contain a data write");
        }
        else if (s.kind === "publish") {
          unique(s.id);
          if (r.applicationFlow.schema !== "application-flow/3" || operation !== "write" || safe(operation) || s.operation !== "write" || ++publishes > 1 || Object.keys(s).some(k => !["id", "kind", "target", "edge", "operation"].includes(k)) || !s.edge || s.edge.length > 256 || !resources.has(s.target)) throw Error("Publish requires one sequential mutating write in application-flow/3");
        }
        else if (s.kind === "compute") { unique(s.id); if (Object.keys(s).some(k => !["id", "kind"].includes(k))) throw Error("Compute step takes no parameters"); }
        else if (s.kind === "parallel") {
          unique(s.id);
          if (Object.keys(s).some(k => !["id", "kind", "branches", "wait"].includes(k)) || s.branches.length < 2 || s.branches.length > 8) throw Error("Parallel needs 2–8 single-call branches");
          if (s.wait !== "all" && (!Number.isSafeInteger(s.wait) || s.wait < 1 || s.wait > s.branches.length)) throw Error("Invalid join threshold");
          if (new Set(s.branches.map(b => b.target)).size !== s.branches.length) throw Error("Parallel siblings must use distinct paths");
          for (const b of s.branches) call(b, true);
        } else throw Error("Unsupported application flow step");
      }
    }
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string, op: string): void => {
    const key = JSON.stringify([id, op]);
    if (visiting.has(key)) throw Error("Application flow operation dependency cycle");
    if (visited.has(key)) return;
    const r = resources.get(id); if (!r) throw Error("Missing flow dependency");
    visiting.add(key);
    if (r.kind === "router") for (const backend of r.backends) visit(backend, op);
    else {
      if (!r.profiles[op] || !input.profiles.some(p => p.id === r.profiles[op] && p.operation === op)) throw Error("Missing target operation profile");
      const flow = r.kind === "compute" ? r.applicationFlow?.operations[op] : undefined;
      if (flow) for (const s of flow.steps) {
        if (s.kind === "call" || s.kind === "data" || s.kind === "publish") visit(s.target, s.operation ?? op);
        if (s.kind === "parallel") for (const b of s.branches) visit(b.target, b.operation ?? op);
      }
      else { const target = r.kind === "compute" ? r.downstreamByOperation?.[op] ?? r.downstream : r.downstream; if (target) visit(target, op); }
    }
    visiting.delete(key); visited.add(key);
  };
  for (const r of input.resources) for (const op of input.operations) visit(r.id, op.id);
}
