import { requireKnown } from "../../reality/quantity";
import { createComputeRuntime, validateComputeInput } from "../compute/run";
import { lexical } from "../time";
import type { NetworkInput } from "./contracts";
import { computeAdapter, validateNetwork } from "./validate";
import { networkLink } from "./link";
import { pathTransport } from "./transport";
import { loadBalancer } from "./load-balancer";
import { networkTrace } from "./trace";
import { NETWORK_POLICY_LEDGER } from "./policy";

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
  validateNetwork(authored);
  validateComputeInput(computeAdapter(authored));
  const input: NetworkInput = JSON.parse(JSON.stringify(authored));
  for (const xs of [input.links, input.paths, input.networkInterventions, input.resources]) xs.sort((a, b) => lexical(a.id, b.id));
  for (const r of input.resources) if (r.kind === "load-balancer") r.backends.sort(lexical);
  let measure: () => NetworkSnapshot;
  const runtime = createComputeRuntime(computeAdapter(input), (kernel, deliver, controls) => {
    const trace = networkTrace(kernel, input.limits.maxRawResults), states = new Map(Object.entries(input.endpoints));
    for (const r of input.resources) if (r.kind !== "load-balancer" && !states.get(r.id)!.alive) controls.pause(r.id, true);
    const links = new Map(input.links.map((l) => [l.id, networkLink(l, kernel, trace.emit)]));
    const paths = new Map(input.paths.map((p) => [JSON.stringify([p.source, p.target]), pathTransport(p, kernel, links, deliver, (id) => states.get(id)!.alive, trace.emit)]));
    const lbs = new Map(input.resources.filter((r) => r.kind === "load-balancer").map((r) => [r.id, loadBalancer(r, kernel, paths, new Map(input.operations.map((o) => [o.id, o])), input.seed, requireKnown(input.horizon, "us"), trace.emit)]));
    for (const i of input.networkInterventions) {
      const apply = (active: boolean) => {
        if (i.kind === "partition") links.get(i.target)!.partition(active);
        if (i.kind === "bandwidth") links.get(i.target)!.bandwidth(requireKnown(active ? i.bandwidth : input.links.find((l) => l.id === i.target)!.bandwidth, "bytes/s"));
        if (i.kind === "delay") links.get(i.target)!.delay(active ? requireKnown(i.delay, "us") : 0);
        if (i.kind === "service-state") {
          const previous = states.get(i.target)!, next = active ? { alive: i.alive, ready: i.ready } : { ...input.endpoints[i.target]! };
          states.set(i.target, next);
          if (previous.alive !== next.alive && input.resources.find((r) => r.id === i.target)!.kind !== "load-balancer") controls.pause(i.target, !next.alive);
        }
        if (i.kind === "reset") [...paths.values()].find((p) => p.measure().id === i.target)!.reset();
        if (i.kind === "drain") lbs.get(i.target)!.drain(i.backend, requireKnown(i.grace, "us"));
        trace.emit("network-intervention", i.id, active ? "applied" : "ended");
      };
      kernel.schedule(requireKnown(i.at, "us"), 0, JSON.stringify(["network-intervention", i.id]), () => apply(true));
      if ("duration" in i) kernel.schedule(requireKnown(i.at, "us") + requireKnown(i.duration, "us"), -1, JSON.stringify(["network-intervention-end", i.id]), () => apply(false));
    }
    measure = () => ({ links: [...links.values()].map((l) => l.measure()), paths: [...paths.values()].map((p) => p.measure()), loadBalancers: [...lbs.values()].map((lb) => lb.measure()), endpoints: Object.fromEntries(states), trace: trace.measure(), policyLedger: NETWORK_POLICY_LEDGER });
    return {
      send(source, target, work, done) { const path = paths.get(JSON.stringify([source, target])); if (!path) throw new Error("Missing explicit transport path"); return path.exchange(work, (result) => done(result.ok ? "completed" : "rejected")); },
      receive(target, work, done, direct) {
        const state = states.get(target)!;
        if (!state.alive || !state.ready) { done("rejected"); return { admitted: false, state: () => "finished", cancel: () => "already-finished" }; }
        return lbs.get(target)?.accept(work, done) ?? direct();
      },
    };
  });
  return { horizon: runtime.horizon, advanceTo: runtime.advanceTo,
    evidence() { const e = runtime.evidence(); return { ...e, workloadVersion: "m2d/1" as const, network: copy(measure()), networkConfiguration: copy({ links: input.links, paths: input.paths, resources: input.resources.filter((r) => r.kind === "load-balancer"), endpoints: input.endpoints, interventions: input.networkInterventions }),
      unmodeled: ["packets/TCP congestion/retransmission", "TLS framing/cryptography", "DNS/NAT/ephemeral ports", "physical topology/provider transport", "GC/reclaim/swap/OOM", "database query/lock/cache mechanisms", "cost"] }; } };
}
