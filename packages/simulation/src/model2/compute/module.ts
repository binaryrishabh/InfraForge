import { ModuleRegistry, manifest } from "../composition/registry";
import type { ModuleHost } from "../composition/host";
import type { WorkEndpoint } from "../workload/run";
import type { ComputeInput, ComputeState } from "./contracts";
import { computeResource } from "./resource";
import { isComputeProfile, validateCompute } from "./validate";

export function computeModules(input: ComputeInput, computes: Map<string, ReturnType<typeof computeResource>>) {
  let validated = false;
  return new ModuleRegistry<ComputeInput["resources"][number], ModuleHost, WorkEndpoint<ComputeState>>()
    .register("compute", {
      manifest: manifest("compute", "m2c/1"),
      validate(config) { if (!input.resources.includes(config)) throw Error("Foreign compute configuration"); if (!validated) { validateCompute(input); validated = true; } },
      instantiate(config, host) {
        const profiles = new Map(input.operations.flatMap(o => {
          const profile = input.profiles.find(p => p.id === config.profiles[o.id]);
          return profile && isComputeProfile(profile) ? [[o.id, profile] as const] : [];
        }));
        const resource = computeResource(config, profiles, host.clock, host.send, host.causal, host.cpu);
        computes.set(config.id, resource); return resource;
      },
    });
}
