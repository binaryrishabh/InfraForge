import { requireKnown } from "../../reality/quantity";
import { createComputeRuntime, validateComputeInput } from "../compute/run";
import { lexical } from "../time";
import type { ConnectionHook, NetworkInput, PathConfig } from "./contracts";
import { computeAdapter, validateNetwork } from "./validate";
import { networkLink } from "./link";
import { pathTransport } from "./transport";
import type { loadBalancer } from "./load-balancer";
import { loadBalancerModules } from "./module";
import { networkTrace } from "./trace";
import { NETWORK_POLICY_LEDGER } from "./policy";
import type { ResourceFactory } from "../compute/run";
import type { EventKernel } from "../time";
import type { Trace } from "./contracts";
import type { Invocation, Receipt, RemoteOutcome } from "../workload/contracts";
import type { RuntimeUsageObserver } from "../../reality/metering/contracts";
import type { CausalObserver } from "../workload/causal";
import type { CpuOwners, ClockOwners } from "../composition/host";

export interface NetworkContext {
  setReady(id: string, ready: boolean, owner?: string): void;
  endpoint(id: string): { alive: boolean; ready: boolean };
  reachable(path: string): boolean;
  observe(id: string): unknown;
  inspect?(id: string): unknown;
  setAvailable(id: string, alive: boolean): void;
  abortOwned(id: string): void;
  retireOwner?(id: string): void;
  drain(lb: string, backend: string, grace: number): void;
  backend(lb: string, backend: string): { health: boolean; draining: boolean; outstanding: number };
}
export interface NetworkExtension {
  cpuFor?: CpuOwners;
  clockFor?: ClockOwners;
  usage?: RuntimeUsageObserver;
  causal?: CausalObserver;
  resource: ResourceFactory;
  install?(kernel: EventKernel, trace: Trace, context: NetworkContext): void;
  disconnected?(target: string, session: string): void;
  connection?(path: PathConfig, kernel: EventKernel, send: (source: string, target: string, work: Invocation, done: (outcome: RemoteOutcome) => void) => Receipt, context: NetworkContext): ConnectionHook | undefined;
  receive?(target: string, work: Invocation, done: (outcome: RemoteOutcome) => void, next: () => Receipt): Receipt | undefined;
}

interface NetworkSnapshot {
  links: ReturnType<ReturnType<typeof networkLink>["measure"]>[];
  paths: ReturnType<ReturnType<typeof pathTransport>["measure"]>[];
  loadBalancers: ReturnType<ReturnType<typeof loadBalancer>["measure"]>[];
  endpoints: Record<string, { alive: boolean; ready: boolean }>;
  trace: ReturnType<ReturnType<typeof networkTrace>["measure"]>;
  policyLedger: typeof NETWORK_POLICY_LEDGER;
}
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export function createNetworkModel2(authored: NetworkInput) {
  return createNetworkRuntime(authored);
}
export function createNetworkRuntime(authored: NetworkInput, extension?: NetworkExtension) {
  validateNetwork(authored);
  validateComputeInput(computeAdapter(authored));
  const input: NetworkInput = JSON.parse(JSON.stringify(authored));
  for (const xs of [input.links, input.paths, input.networkInterventions, input.resources]) xs.sort((a, b) => lexical(a.id, b.id));
  for (const r of input.resources) if (r.kind === "load-balancer") r.backends.sort(lexical);
  let measure: () => NetworkSnapshot;
  const runtime = createComputeRuntime(computeAdapter(input), (kernel, deliver, controls) => {
    const trace = networkTrace(kernel, input.limits.maxRawResults, extension?.causal), states = new Map(Object.entries(input.endpoints).map(([id, state]) => [id, { ...state }])), readiness = new Map<string, Map<string, boolean>>(), activeStates = new Map<string, { alive: boolean; ready: boolean }>();
    const availability = new Map<string, boolean>();
    const applyState = (id: string) => { const desired = activeStates.get(id) ?? input.endpoints[id]!; const next = { alive: desired.alive && (availability.get(id) ?? true), ready: desired.ready && [...(readiness.get(id)?.values() ?? [])].every(Boolean) }; const previous = states.get(id)!; states.set(id, next); if (previous.alive !== next.alive && input.resources.find((r) => r.id === id)!.kind !== "load-balancer") controls.pause(id, !next.alive); };
    const context: NetworkContext = { abortOwned: controls.abortOwned, setReady(id, ready, owner = "default") { if (!states.has(id)) throw Error("Unknown readiness target"); const gates = readiness.get(id) ?? new Map<string, boolean>(); gates.set(owner, ready); readiness.set(id, gates); applyState(id); }, setAvailable(id, alive) { if (!states.has(id)) throw Error("Unknown availability target"); availability.set(id, alive); applyState(id); }, drain(lb, backend, grace) { lbs.get(lb)!.drain(backend, grace); }, backend(lb, backend) { return lbs.get(lb)!.backend(backend); }, endpoint: (id) => ({ ...states.get(id)! }), observe: controls.observe, inspect: (id) => controls.observe(id) ?? lbs.get(id)?.measure(), reachable: (id) => { const p = input.paths.find((p) => p.id === id); return !!p && [...p.request, ...p.response].every((l) => links.get(l)!.reachable()); } };
    for (const r of input.resources) if (r.kind !== "load-balancer" && !states.get(r.id)!.alive) controls.pause(r.id, true);
    extension?.install?.(kernel, trace.emit, context);
    const links = new Map(input.links.map((l) => [l.id, networkLink(l, kernel, trace.emit, extension?.usage)]));
    const paths = new Map<string, ReturnType<typeof pathTransport>>();
    context.retireOwner = (id) => { for (const r of input.resources) if (r.id === id || r.id.startsWith(id + "/")) context.setReady(r.id, false, "terminated"); for (const p of input.paths) if (p.source === id || p.source.startsWith(id + "/")) paths.get(JSON.stringify([p.source, p.target]))!.reset(); };
    const send = (source: string, target: string, work: Invocation, done: (outcome: RemoteOutcome) => void) => { const path = paths.get(JSON.stringify([source, target])); if (!path) throw Error("Missing explicit transport path"); return path.exchange(work, (result) => done(result.ok ? "completed" : "rejected")); };
    for (const p of input.paths) paths.set(JSON.stringify([p.source, p.target]), pathTransport(p, kernel, links, deliver, (id) => states.get(id)!.alive, trace.emit, (session, target) => extension?.disconnected?.(target, session), extension?.connection?.(p, kernel, send, context)));
    const modules = loadBalancerModules(input);
    const lbs = new Map(input.resources.filter(r => modules.has(r.kind)).map(r => [r.id, modules.create(r, { clock: extension?.clockFor?.(r.id, kernel) ?? kernel, send: (target, work, done) => send(r.id, target, work, done), paths, trace: trace.emit, causal: extension?.causal })]));
    for (const i of input.networkInterventions) {
      const clock = (i.kind === "service-state" || i.kind === "drain") ? extension?.clockFor?.(i.target, kernel) ?? kernel : kernel;
      const apply = (active: boolean) => {
        if (i.kind === "partition") links.get(i.target)!.partition(active);
        if (i.kind === "bandwidth") links.get(i.target)!.bandwidth(requireKnown(active ? i.bandwidth : input.links.find((l) => l.id === i.target)!.bandwidth, "bytes/s"));
        if (i.kind === "delay") links.get(i.target)!.delay(active ? requireKnown(i.delay, "us") : 0);
        if (i.kind === "service-state") {
          if (active) activeStates.set(i.target, { alive: i.alive, ready: i.ready }); else activeStates.delete(i.target);
          applyState(i.target);
        }
        if (i.kind === "reset") [...paths.values()].find((p) => p.measure().id === i.target)!.reset();
        if (i.kind === "drain") lbs.get(i.target)!.drain(i.backend, requireKnown(i.grace, "us"));
        trace.emit("network-intervention", i.id, active ? "applied" : "ended");
      };
      clock.schedule(requireKnown(i.at, "us"), 0, JSON.stringify(["network-intervention", i.id]), () => apply(true));
      if ("duration" in i) clock.schedule(requireKnown(i.at, "us") + requireKnown(i.duration, "us"), -1, JSON.stringify(["network-intervention-end", i.id]), () => apply(false));
    }
    measure = () => ({ links: [...links.values()].map((l) => l.measure()), paths: [...paths.values()].map((p) => p.measure()), loadBalancers: [...lbs.values()].map((lb) => lb.measure()), endpoints: Object.fromEntries(states), trace: trace.measure(), policyLedger: NETWORK_POLICY_LEDGER });
    return {
      send,
      receive(target, work, done, direct) {
        const state = states.get(target)!;
        if (!state.alive || !state.ready) { done("rejected"); return { admitted: false, state: () => "finished", cancel: () => "already-finished" }; }
        const next = () => lbs.get(target)?.accept(work, done) ?? direct();
        return extension?.receive?.(target, work, done, next) ?? next();
      },
    };
  }, extension?.resource, extension?.causal, extension?.cpuFor, extension?.clockFor);
  return { horizon: runtime.horizon, advanceTo: runtime.advanceTo,
    evidence() { const e = runtime.evidence(); return { ...e, workloadVersion: "m2d/1" as const, network: copy(measure()), networkConfiguration: copy({ links: input.links, paths: input.paths, resources: input.resources.filter((r) => r.kind === "load-balancer"), endpoints: input.endpoints, interventions: input.networkInterventions }),
      unmodeled: ["packets/TCP congestion/retransmission", "TLS framing/cryptography", "DNS/NAT/ephemeral ports", "physical topology/provider transport", "GC/reclaim/swap/OOM", "database query/lock/cache mechanisms", "cost"] }; } };
}
