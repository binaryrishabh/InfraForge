import { VM_CPU_QUOTA_PERIOD_US, VM_CPU_QUOTA_HELP, type Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity, type Unit } from "../../reality/quantity";
import type { RealityEntry } from "../../reality/ledger";
import type { SystemsInput } from "../systems/contracts";

export const VM_CPU_QUOTA_PROFILE = "vm-cpu-quota/1" as const;
export const changedVmCpuQuota = (r: Resource) => r.type === "Virtual Machine" && r.vmCpuQuota !== undefined;
export const vmCpuQuotaChanges = (resources: readonly Resource[]) => resources.some(changedVmCpuQuota);

export function quotaBudget(cores: number, percent: number) {
  if (!Number.isSafeInteger(cores) || cores < 1 || !Number.isSafeInteger(percent) || percent < 1 || percent > 100) throw Error("Application CPU quota requires integer modeled cores and percentage");
  // Integer core-microseconds, rounded down once after multiplying all factors.
  const budget = BigInt(cores) * BigInt(VM_CPU_QUOTA_PERIOD_US) * BigInt(percent) / 100n;
  if (budget > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("Application CPU quota budget overflows");
  return Number(budget);
}

type QuantityBuilder = <U extends Unit>(id: string, value: number, unit: U, sentence?: string, authored?: boolean) => Quantity<U>;
export function vmCpuQuota(r: Resource, role: string, cores: number, q: QuantityBuilder, ledger: RealityEntry[]) {
  if (!changedVmCpuQuota(r) || role !== "main" || r.asyncWorker?.enabled) return {};
  const percent = r.vmCpuQuota!.limitPercent, id = `${r.id}.${role}.quota`;
  q(`${r.id}.vmCpuQuota.limitPercent`, percent, "count", "Saved percentage of modeled total VM CPU capacity; independent of worker and queue limits.", true);
  const period = q(`${id}.period`, VM_CPU_QUOTA_PERIOD_US, "us", "Fixed educational CPU quota window: 100 ms.");
  const budget = q(`${id}.budget`, quotaBudget(cores, percent), "cpu-us", VM_CPU_QUOTA_HELP, true);
  Object.assign(ledger.at(-1)!, { classification: "derived", formula: `floor(${cores} * ${VM_CPU_QUOTA_PERIOD_US} * ${percent} / 100)`, provenance: [
    { source: `saved-design:${r.id}.vmCpuQuota.limitPercent`, supports: "implementation", detail: "Authored integer percent of modeled total CPU capacity." },
    { source: `${r.id}.${role}.cores`, supports: "implementation", detail: "Modeled cores multiplied by fixed 100 ms window; integer division rounds down in core-microseconds." },
  ] });
  return { quota: { budget, period } };
}

export function validateVmCpuQuotaBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(changedVmCpuQuota)) {
    const replicas = input.resources.filter(d => d.id === r.id || (d.id.startsWith(`${r.id}#`) && !d.id.includes("/")));
    if (!replicas.length || r.asyncWorker?.enabled) throw Error("Application CPU quota requires its owned request-serving compute engine");
    for (const app of replicas) {
      if (app.kind !== "compute" || !app.quota) throw Error("Application CPU quota requires a compute endpoint with scheduler quota");
      if (requireKnown(app.quota.period, "us") !== VM_CPU_QUOTA_PERIOD_US || requireKnown(app.quota.budget, "cpu-us") !== quotaBudget(requireKnown(app.cores, "cores"), r.vmCpuQuota!.limitPercent)) throw Error("Scheduler quota must match saved application CPU limit");
    }
  }
}
