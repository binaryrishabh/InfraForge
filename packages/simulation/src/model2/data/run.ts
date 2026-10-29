import { requireKnown } from "../../reality/quantity";
import { createNetworkRuntime } from "../network/run";
import type { DataInput } from "./contracts";
import { isData, networkAdapter, validateData } from "./validate";
import { relationalDatabase } from "./database";
import { keyedCache } from "./cache";
import { cacheAside } from "./aside";
import { dataModules } from "./modules";
import { DATA_POLICY_LEDGER } from "./policy";
import type { NetworkExtension } from "../network/run";
import type { DatabaseIo } from "./io";
import type { Trace } from "../network/contracts";
import type { EventKernel } from "../time";
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function createDataModel2(authored: DataInput) {
  return createDataRuntime(authored);
}
export function createDataRuntime(authored: DataInput, extension?: NetworkExtension & { databaseIoFor?(id: string, clock: EventKernel): DatabaseIo | undefined }) {
  validateData(authored);
  const input = copy(authored);
  input.resources.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const databases = new Map<string, ReturnType<typeof relationalDatabase>>(), caches = new Map<string, ReturnType<typeof keyedCache>>(), applications = new Map<string, ReturnType<typeof cacheAside>>();
  let sessionTrace: Trace | undefined;
  const modules = dataModules(input, { databases, caches, applications });
  const runtime = createNetworkRuntime(networkAdapter(input), {
    ...extension,
    resource(id, kernel, send) {
      const external = extension?.resource(id, kernel, send); if (external) return external;
      const config = input.resources.find((r) => r.id === id)!;
      if (modules.has(config.kind)) return modules.create(config, { clock: extension?.clockFor?.(id, kernel) ?? kernel, send, causal: extension?.causal, cpu: extension?.cpuFor?.(id, kernel), databaseIo: config.kind === "relational" ? extension?.databaseIoFor?.(id, kernel) : undefined });
    },
    disconnected(target, session) { databases.get(target)?.closeSession(session); extension?.disconnected?.(target, session); },
    connection(path, kernel, send, context) {
      const external = extension?.connection?.(path, kernel, send, context);
      const config = input.resources.find(r => r.id === path.target);
      if (config?.kind !== "relational" || config.semantics !== "postgresql-keyed/1") return external;
      const database = databases.get(path.target)!;
      // A connection first passes the other gate (for example the TLS handshake), then asks the database for a session,
      // as a real client does. The database refuses it when its session limit is full.
      const open = (id: string) => database.openSession(id, path.pool.evidenceProfile ? kind => sessionTrace?.(kind, id, path.target, undefined, undefined, true) : undefined);
      const refusal = path.pool.evidenceProfile ? "session-limit" as const : "backend-rejected" as const;
      return {
        holdLeaseUntilRemoteTerminal: true,
        open(id, done) {
          if (!external) { done(undefined, open(id) ? undefined : refusal); return () => false; }
          return external.open(id, (route, failure) => {
            if (failure) return done(route, failure);
            if (open(id)) return done(route);
            external.close(id); done(route, refusal);
          });
        },
        close(id) { database.closeSession(id); external?.close(id); },
        returnTraffic(id) { return database.sessionAlive(id) && (external?.returnTraffic?.(id) ?? true); },
      };
    },
    install(kernel, trace, context) {
      sessionTrace = trace;
      extension?.install?.(kernel, trace, context);
      for (const i of input.dataInterventions) {
        const clock = extension?.clockFor?.(i.target, kernel) ?? kernel;
        const apply = (active: boolean) => {
          const config = input.resources.find((r) => r.id === i.target)!;
          if (i.kind === "flush") caches.get(i.target)!.flush();
          else if (config.kind === "relational") {
            if (i.kind === "session-capacity") databases.get(i.target)!.sessionCapacity(requireKnown(active ? i.sessions : config.maxSessions, "count"));
            else databases.get(i.target)!.capacity(requireKnown(active ? i.cores : config.execution.cores, "cores"));
          }
          trace("data-intervention", i.id, active ? "applied" : "ended");
        };
        clock.schedule(requireKnown(i.at, "us"), 0, JSON.stringify(["data-intervention", i.id]), () => apply(true));
        if ("duration" in i) clock.schedule(requireKnown(i.at, "us") + requireKnown(i.duration, "us"), -1, JSON.stringify(["data-intervention-end", i.id]), () => apply(false));
      }
    },
  });
  return { horizon: runtime.horizon, advanceTo: runtime.advanceTo, advanceSlice: runtime.advanceSlice, evidence() {
    const e = runtime.evidence(), dataIds = new Set(input.resources.filter(isData).map((r) => r.id)); return { ...e, computeConfiguration: e.computeConfiguration.filter((r) => !dataIds.has(r.id)), workloadVersion: input.workloadVersion, data: copy({ databases: [...databases.values()].map((d) => d.evidence()), caches: [...caches.values()].map((c) => c.evidence()), applications: [...applications.values()].map((a) => a.evidence()), policyLedger: DATA_POLICY_LEDGER }),
      dataConfiguration: copy(input.resources.filter(isData)), unmodeled: [...e.unmodeled.filter((x) => x !== "database query/lock/cache mechanisms"), "physical storage/buffer-cache/WAL fsync/replication/failover", "full SQL/MVCC/Redis protocols"] };
  } };
}
