import { ModuleRegistry, manifest } from "../composition/registry";
import type { ModuleHost } from "../composition/host";
import type { WorkEndpoint } from "../workload/run";
import type { ComputeState } from "../compute/contracts";
import type { DataInput } from "./contracts";
import { validateData } from "./validate";
import { relationalDatabase } from "./database";
import { keyedCache } from "./cache";
import { cacheAside } from "./aside";
import type { DatabaseIo } from "./io";

export function dataModules(input: DataInput, instances: {
  databases: Map<string, ReturnType<typeof relationalDatabase>>;
  caches: Map<string, ReturnType<typeof keyedCache>>;
  applications: Map<string, ReturnType<typeof cacheAside>>;
}) {
  let validated = false;
  const validate = (config: DataInput["resources"][number]) => { if (!input.resources.includes(config)) throw Error("Foreign data configuration"); if (!validated) { validateData(input); validated = true; } };
  return new ModuleRegistry<DataInput["resources"][number], ModuleHost & { databaseIo?: DatabaseIo }, WorkEndpoint<ComputeState>>()
    .register("relational", { manifest: manifest("relational", input.workloadVersion === "m2e-pg/1" ? "m2e-pg/1" : "m2e/1"), validate,
      instantiate(config, host) { const resource = relationalDatabase(config, host.clock, host.causal, host.cpu, host.databaseIo); instances.databases.set(config.id, resource); return resource; } })
    .register("cache", { manifest: manifest("keyed-cache", "m2e/1"), validate,
      instantiate(config, host) { const resource = keyedCache(config, host.clock, host.cpu); instances.caches.set(config.id, resource); return resource; } })
    .register("cache-aside", { manifest: manifest("cache-aside", "m2e/1"), validate,
      instantiate(config, host) { const resource = cacheAside(config, host.clock, host.send, input.seed); instances.applications.set(config.id, resource); return resource; } });
}
