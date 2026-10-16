import { requireKnown } from "../../reality/quantity";
import { createNetworkRuntime } from "../network/run";
import type { DataInput } from "./contracts";
import { isData, networkAdapter, validateData } from "./validate";
import { relationalDatabase } from "./database";
import { keyedCache } from "./cache";
import { cacheAside } from "./aside";
import { DATA_POLICY_LEDGER } from "./policy";
import type { NetworkExtension } from "../network/run";
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function createDataModel2(authored: DataInput) {
  return createDataRuntime(authored);
}
export function createDataRuntime(authored: DataInput, extension?: NetworkExtension) {
  validateData(authored);
  const input = copy(authored);
  input.resources.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const databases = new Map<string, ReturnType<typeof relationalDatabase>>(), caches = new Map<string, ReturnType<typeof keyedCache>>(), applications = new Map<string, ReturnType<typeof cacheAside>>();
  const runtime = createNetworkRuntime(networkAdapter(input), {
    ...extension,
    resource(id, kernel, send) {
      const external = extension?.resource(id, kernel, send); if (external) return external;
      const config = input.resources.find((r) => r.id === id)!; if (!isData(config)) return;
      if (config.kind === "relational") { const r = relationalDatabase(config, kernel, extension?.causal); databases.set(id, r); return r; }
      if (config.kind === "cache") { const r = keyedCache(config, kernel); caches.set(id, r); return r; }
      const r = cacheAside(config, kernel, send, input.seed); applications.set(id, r); return r;
    },
    disconnected(target, session) { databases.get(target)?.closeSession(session); extension?.disconnected?.(target, session); },
    install(kernel, trace, context) {
      extension?.install?.(kernel, trace, context);
      for (const i of input.dataInterventions) {
        const apply = (active: boolean) => {
          const config = input.resources.find((r) => r.id === i.target)!;
          if (i.kind === "flush") caches.get(i.target)!.flush();
          else if (config.kind === "relational") {
            if (i.kind === "session-capacity") databases.get(i.target)!.sessionCapacity(requireKnown(active ? i.sessions : config.maxSessions, "count"));
            else databases.get(i.target)!.capacity(requireKnown(active ? i.cores : config.execution.cores, "cores"));
          }
          trace("data-intervention", i.id, active ? "applied" : "ended");
        };
        kernel.schedule(requireKnown(i.at, "us"), 0, JSON.stringify(["data-intervention", i.id]), () => apply(true));
        if ("duration" in i) kernel.schedule(requireKnown(i.at, "us") + requireKnown(i.duration, "us"), -1, JSON.stringify(["data-intervention-end", i.id]), () => apply(false));
      }
    },
  });
  return { horizon: runtime.horizon, advanceTo: runtime.advanceTo, evidence() {
    const e = runtime.evidence(), dataIds = new Set(input.resources.filter(isData).map((r) => r.id)); return { ...e, computeConfiguration: e.computeConfiguration.filter((r) => !dataIds.has(r.id)), workloadVersion: "m2e/1" as const, data: copy({ databases: [...databases.values()].map((d) => d.evidence()), caches: [...caches.values()].map((c) => c.evidence()), applications: [...applications.values()].map((a) => a.evidence()), policyLedger: DATA_POLICY_LEDGER }),
      dataConfiguration: copy(input.resources.filter(isData)), unmodeled: [...e.unmodeled.filter((x) => x !== "database query/lock/cache mechanisms"), "physical storage/buffer-cache/WAL fsync/replication/failover", "full SQL/MVCC/Redis protocols"] };
  } };
}
