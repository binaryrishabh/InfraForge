import type { ProductContract, CompiledPool, SemanticSpec, CompiledProduct } from "./contracts";
import type { SystemsInput } from "../systems/contracts";
export function numericOrigins(input: SystemsInput, pools: CompiledPool[], contract: ProductContract, crashes: CompiledProduct["crashes"]): SemanticSpec["numericOrigins"] {
  const rows: SemanticSpec["numericOrigins"] = [], ledger = new Map(input.ledger.map((r) => [r.id, r]));
  const resourceSource = (index: number) => {
    const id = input.resources[index]!.id, [instance, role] = id.split("/"), node = instance!.split("#")[0]!, spec = contract.nodes[node]!;
    return `contract.nodes.${node}.resources[role=${role ?? spec.primary}].config`;
  };
  const source = (path: string): { origin: SemanticSpec["numericOrigins"][number]["origin"]; sources: string[] } => {
    const match = /^input.resources\.(\d+)(.*)$/.exec(path);
    if (match) return { origin: "user-authored", sources: [resourceSource(+match[1]!) + match[2]] };
    if (path.startsWith("input.arrivals")) return { origin: "derived", sources: ["design.workload.targetThroughput", "design.workload.throughputUnit", "design.workload.readWriteRatio", "design.workload.trafficShape", "design.workload.peakMultiplier", "contract.arrival", "contract.horizon", "product-arrivals/1 integer microsecond scheduling and explicit operation mapping"] };
    if (path.startsWith("input.limits")) return { origin: "policy", sources: [path.replace("input.", "contract.") + ": explicit executor budget, no infrastructure capacity claim"] };
    const p = /^pools\.(\d+)\.profile(.*)$/.exec(path); if (p) return { origin: "user-authored", sources: [`contract.nodes.${pools[+p[1]!]!.id}.controller${p[2]}`] };
    if (path.startsWith("input.profiles")) return { origin: "application-profile", sources: [path.replace("input.profiles", "contract.application.demands")] };
    if (path.startsWith("input.systems.commands")) return { origin: "user-authored", sources: [path.replace("input.systems.commands", "contract.commands")] };
    throw Error(`Anonymous compiler number has no origin: ${path}`);
  };
  const visit = (value: unknown, path: string) => {
    if (value && typeof value === "object" && "value" in value && "sources" in value && (path.includes(".retry.authored.") || path.includes(".circuitBreaker.authored."))) {
      rows.push({ path, origin: "user-authored", sources: (value as { sources: string[] }).sources }); return;
    }
    if (typeof value === "number") { rows.push({ path, ...source(path) }); return; }
    if (!value || typeof value !== "object") return;
    if ("kind" in value && "unit" in value && "provenance" in value) {
      const q = value as { provenance: string[] }, facts = q.provenance.map((id) => ledger.get(id)!);
      if (facts.some((r) => !r)) throw Error(`Unresolved compiler provenance ${path}`);
      const classes = facts.map((r) => r.classification);
      const origin = classes.includes("unknown") ? "Unknown" : classes.includes("provider-fact") ? "provider-fact" : classes.includes("derived") ? "derived" : classes.includes("implementation-policy") || path.startsWith("pools.") ? "policy" : classes.includes("user-input") ? "user-authored" : "application-profile";
      rows.push({ path, origin, sources: [...q.provenance, ...facts.flatMap((r) => r.provenance.map((p) => p.source))] }); return;
    }
    for (const [key, child] of Object.entries(value)) if (key !== "ledger") visit(child, `${path}.${key}`);
  }; visit(input, "input"); visit(pools, "pools"); visit(crashes, "crashes"); return rows;
}
