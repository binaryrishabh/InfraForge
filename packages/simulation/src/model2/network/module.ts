import { ModuleRegistry, manifest } from "../composition/registry";
import type { ModuleHost } from "../composition/host";
import type { NetworkInput, Trace } from "./contracts";
import type { pathTransport } from "./transport";
import { requireKnown } from "../../reality/quantity";
import { loadBalancer } from "./load-balancer";
import { validateNetwork } from "./validate";

interface LoadBalancerHost extends ModuleHost {
  paths: Map<string, ReturnType<typeof pathTransport>>;
  trace: Trace;
}
export function loadBalancerModules(input: NetworkInput) {
  let validated = false;
  return new ModuleRegistry<NetworkInput["resources"][number], LoadBalancerHost, ReturnType<typeof loadBalancer>>()
    .register("load-balancer", { manifest: manifest("load-balancer", "m2d/1"),
      validate(config) { if (!input.resources.includes(config)) throw Error("Foreign LB configuration"); if (!validated) { validateNetwork(input); validated = true; } },
      instantiate(config, host) { return loadBalancer(config, host.clock, host.paths, new Map(input.operations.map(o => [o.id, o])), input.seed, requireKnown(input.horizon, "us"), host.trace, host.causal); } });
}
