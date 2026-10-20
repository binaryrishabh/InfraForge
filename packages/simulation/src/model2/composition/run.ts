import { requireKnown, type Quantity } from "../../reality/quantity";
import { createDataRuntime } from "../data/run";
import { validateData } from "../data/validate";
import type { DataInput } from "../data/contracts";
import type { EventClock, EventKernel } from "../time";
import type { NetworkContext } from "../network/run";
import type { CausalObserver } from "../workload/causal";
import type { Invocation, Receipt, RemoteOutcome } from "../workload/contracts";
import { hostCpuPool, memoryBudget } from "./budgets";
import { Lifecycle, type LifecycleIdentity } from "./lifecycle";
import { ModuleRegistry, manifest, type ModuleManifest } from "./registry";

export interface RequestGate {
  receive(target: string, work: Invocation, done: (outcome: RemoteOutcome) => void, next: () => Receipt): Receipt;
  measure(): unknown;
}
export interface MechanismHost { readonly clock: EventClock }
export interface RequestPlugin {
  manifest: ModuleManifest;
  validate(): void;
  instantiate(host: MechanismHost): RequestGate;
}
export interface StackComposition {
  hosts: Array<{ id: string; cores: Quantity<"cores">; memory: Quantity<"bytes"> }>;
  bindings: Array<{ resource: string; host: string; reservedMemory: Quantity<"bytes"> }>;
  plugins?: RequestPlugin[];
  causal?: CausalObserver;
}

// Explicit internal composition; it does not participate in product activation.
// The m2b–m2h entry points continue to pin their original owners and policies.
export function createStackComposition(authored: DataInput, composition: StackComposition) {
  const input: DataInput = JSON.parse(JSON.stringify(authored));
  const hosts: StackComposition["hosts"] = JSON.parse(JSON.stringify(composition.hosts));
  const bindings: StackComposition["bindings"] = JSON.parse(JSON.stringify(composition.bindings));
  hosts.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  bindings.sort((a, b) => a.resource < b.resource ? -1 : a.resource > b.resource ? 1 : 0);
  validateData(input);
  const resources = new Map(input.resources.map(r => [r.id, r]));
  if (input.resources.some(r => !["compute", "relational", "cache", "cache-aside", "load-balancer"].includes(r.kind))) throw Error("Unsupported first-stack resource");
  const hostConfigs = new Map(hosts.map(h => [h.id, h])), bindingByResource = new Map(bindings.map(b => [b.resource, b]));
  if (hostConfigs.size !== hosts.length || bindingByResource.size !== bindings.length) throw Error("Duplicate host/binding");
  for (const h of hosts) {
    if (!h.id || !Number.isFinite(requireKnown(h.cores, "cores")) || requireKnown(h.cores, "cores") <= 0 || !Number.isSafeInteger(requireKnown(h.memory, "bytes")) || requireKnown(h.memory, "bytes") < 0) throw Error("Invalid host budget");
  }
  for (const b of bindings) {
    const r = resources.get(b.resource), h = hostConfigs.get(b.host);
    if (!h || !r || !["compute", "relational", "cache"].includes(r.kind)) throw Error("Unsupported host binding");
    const execution = r.kind === "compute" ? r : "execution" in r ? r.execution : undefined;
    // Version 1 binds the authored host capacity exactly. Per-role quotas and
    // resizing need an explicit policy; they must not silently spend twice.
    if (!execution || execution.quota || requireKnown(execution.cores, "cores") !== requireKnown(h.cores, "cores") || input.interventions.some(i => i.target === r.id) || input.dataInterventions.some(i => i.kind === "cpu-capacity" && i.target === r.id)) throw Error("Shared host capacity/quota mismatch");
    const bytes = requireKnown(b.reservedMemory, "bytes");
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw Error("Invalid memory reservation");
  }
  for (const h of hosts) if (bindings.filter(b => b.host === h.id).reduce((total, b) => total + requireKnown(b.reservedMemory, "bytes"), 0) > requireKnown(h.memory, "bytes")) throw Error("Host memory reservation exhausted");

  const lifecycle = new Lifecycle(Math.max(1, resources.size + (composition.plugins?.length ?? 0)));
  const identities = new Map([...resources.keys()].sort().map(id => [id, lifecycle.create(id)]));
  for (const identity of identities.values()) lifecycle.register(identity);
  const memory = new Map(hosts.map(h => [h.id, memoryBudget(h.id, h.memory)]));
  const pools = new Map<string, ReturnType<typeof hostCpuPool>>(), leases = new Map<string, ReturnType<ReturnType<typeof hostCpuPool>["lease"]>>();
  const gates: RequestGate[] = [], plugins = [...(composition.plugins ?? [])];
  const registry = new ModuleRegistry<{ id: string; kind: string }, MechanismHost, RequestGate>();
  for (const plugin of plugins) {
    if (resources.has(plugin.manifest.id)) throw Error("Plugin identity collides with resource");
    registry.register(plugin.manifest.id, { manifest: plugin.manifest, validate: () => plugin.validate(), instantiate: (_config, host) => plugin.instantiate(host) });
  }
  // Validate every plug-in before allocating resources or scheduling any work.
  for (const plugin of plugins) plugin.validate();
  let context: NetworkContext;
  const runtime = createDataRuntime(input, {
    causal: composition.causal,
    resource: () => undefined,
    clockFor: (id, clock) => lifecycle.clock(identities.get(id)!, clock),
    cpuFor(id, clock: EventKernel) {
      const binding = bindingByResource.get(id); if (!binding) return undefined;
      if (leases.has(id)) throw Error("Duplicate runtime CPU binding");
      const config = hostConfigs.get(binding.host)!, identity = identities.get(id)!;
      const pool = pools.get(config.id) ?? hostCpuPool(config.id, config.cores, clock); pools.set(config.id, pool);
      const reservation = memory.get(config.id)!.reserve(identity, binding.reservedMemory);
      if (!reservation) throw Error("Host memory admission rejected");
      const lease = pool.lease(identity); leases.set(id, lease);
      lifecycle.own(identity, () => { lease.release(); reservation.release(); });
      return lease.scheduler;
    },
    install(clock, _trace, network) {
      context = network;
      for (const identity of identities.values()) if (input.endpoints[identity.id]!.alive && input.endpoints[identity.id]!.ready) lifecycle.ready(identity);
      // Registration order is execution order and is retained in the lock.
      for (const plugin of plugins) {
        const identity = lifecycle.create(plugin.manifest.id); lifecycle.register(identity); lifecycle.ready(identity);
        gates.push(registry.create({ id: plugin.manifest.id, kind: plugin.manifest.id }, { clock: lifecycle.clock(identity, clock) }));
      }
    },
    receive(target, work, done, next) {
      const dispatch = (index: number): Receipt => gates[index]?.receive(target, work, done, () => dispatch(index + 1)) ?? next();
      return dispatch(0);
    },
  });
  const identityFor = (id: string): LifecycleIdentity => { const identity = identities.get(id); if (!identity) throw Error("Unknown lifecycle resource"); return identity; };
  return {
    horizon: runtime.horizon, advanceTo: runtime.advanceTo,
    drain(id: string) { const identity = identityFor(id); lifecycle.drain(identity); context.setReady(id, false, "composition-drain"); },
    retire(id: string) {
      const identity = identityFor(id);
      if (lifecycle.state(identity) !== "draining") throw Error("Drain before retirement");
      const observed = (context.inspect?.(id) ?? context.observe(id)) as Record<string, unknown> | undefined;
      if (!observed || ["queued", "serving", "waiting", "active", "pending"].some(field => typeof observed[field] === "number" && observed[field] > 0)) throw Error("Resource still owns live work");
      lifecycle.retire(identity); context.retireOwner?.(id);
    },
    evidence() {
      return { ...runtime.evidence(), composition: {
        revision: "stack-composition/1", modules: [manifest("compute", "m2c/1"), manifest("relational", input.workloadVersion === "m2e-pg/1" ? "m2e-pg/1" : "m2e/1"), manifest("keyed-cache", "m2e/1"), manifest("cache-aside", "m2e/1"), manifest("load-balancer", "m2d/1"), ...registry.lock()],
        pluginOrder: plugins.map(p => p.manifest.id), hosts: JSON.parse(JSON.stringify(hosts)), bindings: JSON.parse(JSON.stringify(bindings)), lifecycle: lifecycle.snapshot(),
        cpu: [...pools.values()].map(p => p.measure()), memory: [...memory.values()].map(m => m.measure()), mechanisms: gates.map(g => g.measure()),
        memoryCoverage: "Authored reservation admission only; full resident memory remains Unknown where module coverage is partial",
        cpuAccounting: "Pool core-time is authoritative; member availableCoreUs references the same host and must not be summed",
      } };
    },
  };
}
