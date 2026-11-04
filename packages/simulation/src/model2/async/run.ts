import { serverless } from "../serverless/run";
import { scheduler } from "../scheduled/run";
import { apiGateway } from "../gateway/run";
import { requireKnown } from "../../reality/quantity";
import { createDataRuntime } from "../data/run";
import type { AsyncInput } from "./contracts";
import { isAsync, dataAdapter, validateAsync } from "./validate";
import { deliveryQueue } from "./broker";
import { objectStore } from "./objects";
import { asyncPublisher } from "./publisher";
import { asyncWorker } from "./worker";
import { eventBus } from "../eventbus/run";
import { ASYNC_POLICY_LEDGER } from "./policy";
import type { NetworkExtension } from "../network/run";
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export function createAsyncModel2(authored: AsyncInput) {
  return createAsyncRuntime(authored);
}
export function createAsyncRuntime(authored: AsyncInput, extension?: NetworkExtension) {
  validateAsync(authored); const i = copy(authored); i.resources.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const brokers = new Map<string, ReturnType<typeof deliveryQueue>>(), stores = new Map<string, ReturnType<typeof objectStore>>(), publishers = new Map<string, ReturnType<typeof asyncPublisher>>(), workers = new Map<string, ReturnType<typeof asyncWorker>>();
  const functions = new Map<string, ReturnType<typeof serverless>>();
  const schedulers = new Map<string, ReturnType<typeof scheduler>>();
  const gateways = new Map<string, ReturnType<typeof apiGateway>>();
  const buses = new Map<string, ReturnType<typeof eventBus>>();
  const runtime = createDataRuntime(dataAdapter(i), {
    ...extension,
    resource(id, kernel, send) {
      const external = extension?.resource(id, kernel, send); if (external) return external;
      const r = i.resources.find((r) => r.id === id)!; if (!isAsync(r)) return;
      if (r.kind === "serverless") { const service = serverless(r, kernel, send, i.seed); functions.set(id, service); return service; }
      if (r.kind === "scheduler") { const service = scheduler(r, kernel, send, requireKnown(i.horizon, "us")); schedulers.set(id, service); return service; }
      if (r.kind === "api-gateway") { const service = apiGateway(r, kernel, send); gateways.set(id, service); return service; }
      if (r.kind === "event-bus") { const service = eventBus(r, kernel, send); buses.set(id, service); return service; }
      if (r.kind === "delivery-queue") { const service = deliveryQueue(r, kernel); brokers.set(id, service); return service; }
      if (r.kind === "object-store") { const service = objectStore(r, kernel, extension?.usage); stores.set(id, service); return service; }
      if (r.kind === "async-publisher") { const service = asyncPublisher(r, kernel, send); publishers.set(id, service); return service; }
      const service = asyncWorker(r, kernel, send, requireKnown(i.horizon, "us")); workers.set(id, service); return service;
    },
    install(kernel, trace, context) {
      extension?.install?.(kernel, trace, context);
      for (const worker of workers.values()) worker.start();
      for (const timer of schedulers.values()) timer.start();
      for (const f of i.asyncInterventions) {
        const apply = (enabled: boolean) => {
          const r = i.resources.find((r) => r.id === f.target)!;
          if (f.kind === "consumer-state") workers.get(f.target)!.pause(enabled ? !f.available : false);
          else if (f.kind === "object-access") stores.get(f.target)!.access(enabled ? f.reads : true, enabled ? f.writes : true);
          else if (r.kind === "object-store") stores.get(f.target)!.capacity(enabled ? requireKnown(f.bytes, "bytes") : r.capacity ? requireKnown(r.capacity, "bytes") : undefined);
          trace("async-intervention", f.id, enabled ? "applied" : "ended");
        };
        kernel.schedule(requireKnown(f.at, "us"), 0, JSON.stringify(["async-fault", f.id]), () => apply(true));
        kernel.schedule(requireKnown(f.at, "us") + requireKnown(f.duration, "us"), -1, JSON.stringify(["async-fault-end", f.id]), () => apply(false));
      }
    },
  });
  return { horizon: runtime.horizon, advanceTo: runtime.advanceTo, measureObjective: runtime.measureObjective, inspectData: runtime.inspectData, inspectObject: (id: string) => stores.get(id)?.evidence(), inspectFunction: (id: string) => functions.get(id)?.evidence(), inspectScheduler: (id: string) => schedulers.get(id)?.evidence(), inspectGateway: (id: string) => gateways.get(id)?.evidence(), inspectEventBus: (id: string) => buses.get(id)?.evidence(), inspectQueue: (id: string) => brokers.get(id)?.inspectQueue(), inspectWorker: (id: string) => workers.get(id)?.inspectWorker(), evidence() { const e = runtime.evidence(), ids = new Set(i.resources.filter(isAsync).map((r) => r.id)); return { ...e, workloadVersion: "m2f/1" as const, computeConfiguration: e.computeConfiguration.filter((r) => !ids.has(r.id)), asyncConfiguration: copy(i.resources.filter(isAsync)), asynchronous: copy({ ...(functions.size ? { functions: [...functions.values()].map(s => s.evidence()) } : {}), ...(schedulers.size ? { schedulers: [...schedulers.values()].map(s => s.evidence()) } : {}), ...(gateways.size ? { gateways: [...gateways.values()].map(g => g.evidence()) } : {}), ...(buses.size ? { eventBuses: [...buses.values()].map(b => b.evidence()) } : {}), brokers: [...brokers.values()].map((b) => b.evidence()), objects: [...stores.values()].map((s) => s.evidence()), publishers: [...publishers.values()].map((p) => p.evidence()), workers: [...workers.values()].map((w) => w.evidence()), policyLedger: ASYNC_POLICY_LEDGER }), unmodeled: [...e.unmodeled, "physical broker/object persistence/replication", "partitioned logs/offsets/exactly-once cross-resource transactions", "multipart/range/LIST/provider billing"] }; } };
}
