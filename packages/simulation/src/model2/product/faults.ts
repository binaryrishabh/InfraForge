import type { SystemsInput } from "../systems/contracts";
import type { ProductFault } from "./contracts";
import type { derivedLedger } from "./provenance";
import { requireKnown } from "../../reality/quantity";
import type { CompiledProduct } from "./contracts";
export const CHAOS_COMPATIBILITY = {
  DNS: { Crash: "authority retains authored records; resolver invalidates volatile answers; commands abort", CpuSpike: "unavailable", MemoryLeak: "unavailable", NetworkDelay: "explicit links only", DiskFailure: "unavailable" },
  CDN: { Crash: "purge volatile objects and abort commands; restart cold", CpuSpike: "unavailable", MemoryLeak: "unavailable", NetworkDelay: "explicit links only", DiskFailure: "unavailable" },
  Firewall: { Crash: "unavailable: policy device process is not modeled", CpuSpike: "unavailable", MemoryLeak: "unavailable", NetworkDelay: "explicit links only", DiskFailure: "unavailable" },
  "Load Balancer": { Crash: "unavailable: process restart/registration retention is not modeled", CpuSpike: "unavailable", MemoryLeak: "unavailable", NetworkDelay: "explicit links only", DiskFailure: "unavailable" },
  "Virtual Machine": { Crash: "abort owned calls, detach/cancel children, release request memory; restart after explicit profile", CpuSpike: "M2C competing core-time demand", MemoryLeak: "unavailable", NetworkDelay: "explicit links only", DiskFailure: "unavailable" },
  "Container Registry": { Crash: "abort commands; retain logical blobs/manifests/tags only under explicit retention profile", CpuSpike: "unavailable", MemoryLeak: "unavailable", NetworkDelay: "explicit links only", DiskFailure: "unavailable" },
  Cache: { Crash: "abort commands; flush keys/generations; restart cold", CpuSpike: "unavailable", MemoryLeak: "unavailable", NetworkDelay: "explicit links only", DiskFailure: "unavailable" },
  Database: { Crash: "abort uncommitted transactions, clear sessions/locks; retain committed logical rows", CpuSpike: "unavailable", MemoryLeak: "unavailable", NetworkDelay: "explicit links only", DiskFailure: "unavailable" },
  "Object Storage": { Crash: "abort commands; retain logical current objects, physical durability Unknown", CpuSpike: "unavailable", MemoryLeak: "unavailable", NetworkDelay: "explicit links only", DiskFailure: "unavailable" },
  "Message Queue": { Crash: "abort commands; retain logical messages; lease/retention timers continue", CpuSpike: "unavailable", MemoryLeak: "unavailable", NetworkDelay: "explicit links only", DiskFailure: "unavailable" },
  "Monitoring Agent": { Crash: "abort collection/export; retain bounded local buffer in selected logical-retention profile; gaps survive", CpuSpike: "unavailable", MemoryLeak: "unavailable", NetworkDelay: "explicit links only", DiskFailure: "unavailable" },
} as const;
export function compileFaults(faults: ProductFault[], input: SystemsInput, expand: (id: string) => string[], provenance: ReturnType<typeof derivedLedger>) {
  const crashes: CompiledProduct["crashes"] = [];
  for (const fault of faults) {
    if (fault.kind !== "NetworkDelay" && fault.scope !== undefined) throw Error("Only NetworkDelay accepts a link scope; crash names an explicit process/replica role");
    if (["MemoryLeak", "DiskFailure"].includes(fault.kind)) throw Error(`${fault.kind} unavailable: physical ownership/device semantics are incomplete`);
    if (fault.kind === "Crash") {
      if (fault.profile !== "retain-logical-state/1" || !fault.restart || !Number.isSafeInteger(requireKnown(fault.restart, "us")) || requireKnown(fault.restart, "us") < 1 || !Number.isSafeInteger(requireKnown(fault.at, "us") + requireKnown(fault.duration, "us") + requireKnown(fault.restart, "us"))) throw Error("Crash needs explicit resource-specific retention and positive authored process restart/readiness delay");
      for (const target of expand(fault.target)) {
        const r = input.resources.find((r) => r.id === target);
        if (!r || ["load-balancer", "cache-aside", "artifact-client", "async-worker", "async-publisher"].includes(r.kind)) throw Error("Crash unsupported for this lifecycle/owner");
        input.networkInterventions.push({ id: `${fault.id}:${target}`, kind: "service-state", target, at: fault.at, duration: fault.duration, alive: false, ready: false });
        crashes.push({ target, at: fault.at, restartAt: provenance.q(`m2h.${fault.id}.${target}.restartAt`, requireKnown(fault.at, "us") + requireKnown(fault.duration, "us") + requireKnown(fault.restart, "us"), "us", [...fault.at.provenance, ...fault.duration.provenance, ...fault.restart.provenance]) });
        if (r.kind === "cache") input.dataInterventions.push({ id: `${fault.id}:${target}:flush`, kind: "flush", target, at: fault.at });
        if (r.kind === "cdn") input.systems.interventions.push({ id: `${fault.id}:${target}:purge`, kind: "cdn-purge", target, at: fault.at });
        // Compute abort and resolver-cache invalidation are explicit M2H runtime hooks.
      }
    } else if (fault.kind === "CpuSpike") {
      if (!fault.cpu || !fault.parallelism) throw Error("CPU competitor requires explicit core-time demand and parallelism");
      for (const target of expand(fault.target)) { if (input.resources.find((r) => r.id === target)?.kind !== "compute") throw Error("CPU spike is unavailable for managed resources without modeled process CPU"); input.interventions.push({ id: `${fault.id}:${target}`, kind: "competitor", target, at: fault.at, duration: fault.duration, demand: fault.cpu, parallelism: fault.parallelism }); }
    } else if (fault.kind === "NetworkDelay") {
      if (!fault.delay || !fault.scope?.length || fault.scope.some((l) => !input.links.some((link) => link.id === l))) throw Error("Network delay requires explicit materialized link IDs; a resource is not a link");
      for (const target of fault.scope) input.networkInterventions.push({ id: `${fault.id}:${target}`, kind: "delay", target, at: fault.at, duration: fault.duration, delay: fault.delay });
    } else throw Error("Unsupported fault choice");
  }
  return crashes;
}
