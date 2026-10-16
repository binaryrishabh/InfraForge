import { requireKnown } from "../../reality/quantity";
import { createAsyncRuntime } from "../async/run";
import type { Invocation, Receipt } from "../workload/contracts";
import type { SystemsInput } from "./contracts";
import { asyncAdapter, isSystem, validateSystems } from "./validate";
import { dnsAuthority, dnsResolver } from "./dns";
import { objectCdn } from "./cdn";
import { artifactRegistry } from "./registry";
import { artifactClient } from "./startup";
import { monitoringAgent, telemetryBackend } from "./monitor";
import { securityPlane } from "./security";
import { eventRows, SYSTEM_LIMITS, SYSTEM_POLICY_LEDGER } from "./policy";
import type { NetworkContext } from "../network/run";
import type { EventKernel } from "../time";
import type { RuntimeUsageObserver } from "../../reality/metering/contracts";
import type { CausalObserver } from "../workload/causal";
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export interface SystemsExtension {
  usage?: RuntimeUsageObserver;
  causal?: CausalObserver;
  deferredClients: string[];
  crashes?: Array<{ target: string; at: number; restartAt: number }>;
  install(kernel: EventKernel, context: NetworkContext, controls: { artifacts(client: string, replica: string, done: (ok: boolean) => void): void; samples(backend: string, target: string): Array<{ measurementAt: number; arrivedAt: number; values: unknown }> }): void;
}
export function createSystemsModel2(authored: SystemsInput, extension?: SystemsExtension) {
  validateSystems(authored); const i = copy(authored); i.resources.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const authorities = new Map<string, ReturnType<typeof dnsAuthority>>(), resolvers = new Map<string, ReturnType<typeof dnsResolver>>(), cdns = new Map<string, ReturnType<typeof objectCdn>>(), registries = new Map<string, ReturnType<typeof artifactRegistry>>(), clients = new Map<string, ReturnType<typeof artifactClient>>(), monitors = new Map<string, ReturnType<typeof monitoringAgent>>(), backends = new Map<string, ReturnType<typeof telemetryBackend>>();
  let security: ReturnType<typeof securityPlane>, context: NetworkContext, clock: EventKernel;
  const instrumentation = new Map(i.systems.instrumentation.map((p) => [p.target, { produced: 0, bytes: requireKnown(p.bytes, "bytes") }])), observations = eventRows();
  const commandResults: Array<{ id: string; at: number; outcome: string; reply: unknown }> = []; let commandOffered = 0, commandLive = 0, commandCompleted = 0, commandFailed = 0, commandOmitted = 0, retainedFields = 0;
  const resultFits = (value: unknown) => { const pending: unknown[] = [value]; let fields = 0; while (pending.length) { if (++fields + retainedFields > SYSTEM_LIMITS.inputFields) return false; const v = pending.pop(); if (v && typeof v === "object") for (const child of Object.values(v)) pending.push(child); } retainedFields += fields; return true; };
  const runtime = createAsyncRuntime(asyncAdapter(i), {
    usage: extension?.usage,
    causal: extension?.causal,
    resource(id, kernel, send) {
      const r = i.resources.find((r) => r.id === id)!; if (!isSystem(r)) return;
      if (r.kind === "dns-authority") { const service = dnsAuthority(r, kernel); authorities.set(id, service); return service; }
      if (r.kind === "dns-resolver") { const service = dnsResolver(r, kernel, send); resolvers.set(id, service); return service; }
      if (r.kind === "cdn") { const service = objectCdn(r, kernel, send); cdns.set(id, service); return service; }
      if (r.kind === "registry") { const service = artifactRegistry(r, kernel, send); registries.set(id, service); return service; }
      if (r.kind === "artifact-client") { const service = artifactClient(r, kernel, send, i.systems.operation); clients.set(id, service); return service; }
      if (r.kind === "monitor") { const service = monitoringAgent(r, kernel, send); monitors.set(id, service); return service; }
      const service = telemetryBackend(r, kernel); backends.set(id, service); return service;
    },
    install(kernel, _trace, network) {
      context = network; clock = kernel; security = securityPlane(i, kernel, network, (id, name) => resolvers.get(id)?.peek(name));
      const horizon = requireKnown(i.horizon, "us");
      for (const [id, client] of clients) client.start(network, horizon, extension?.deferredClients.includes(id));
      for (const [index, crash] of (extension?.crashes ?? []).entries()) {
        const owner = `restart-${index}`;
        kernel.schedule(crash.at, 0, JSON.stringify(["product-crash", crash.target, index]), () => { network.setReady(crash.target, false, owner); network.abortOwned(crash.target); resolvers.get(crash.target)?.clear(); extension?.causal?.({ atUs: kernel.now, kind: "process-crash", resource: crash.target, detail: {} }); });
        kernel.schedule(crash.restartAt, 0, JSON.stringify(["product-restart", crash.target, index]), () => { network.setReady(crash.target, true, owner); extension?.causal?.({ atUs: kernel.now, kind: "process-ready", resource: crash.target, detail: {} }); });
      }
      extension?.install(kernel, network, { artifacts(client, replica, done) { clients.get(client)!.launch(replica, done); }, samples(backend, target) { return backends.get(backend)?.recent(target) ?? []; } });
      for (const monitor of monitors.values()) monitor.start(horizon);
      for (const f of [...i.systems.interventions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) kernel.schedule(requireKnown(f.at, "us"), 0, JSON.stringify(["systems-intervention", f.id]), () => {
        if (f.kind === "dns-record") authorities.get(f.target)!.update(f.record);
        if (f.kind === "cdn-purge") cdns.get(f.target)!.purge(f.key);
        if (f.kind === "firewall-rules") security.update(f.target, f.rules);
      });
    },
    connection(path, kernel, send) {
      // Authored debug commands enter the same network as application work.
      if (path.id === i.paths[0]!.id) for (const command of [...i.systems.commands].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) kernel.schedule(requireKnown(command.at, "us"), 2, JSON.stringify(["systems-workload", command.id]), () => {
        commandOffered++; commandLive++;
        const work: Invocation = { rootId: JSON.stringify(["systems-workload", command.id]), callId: JSON.stringify(["systems-workload", command.id]), attempt: 1, operation: command.operation, offeredAt: kernel.now, message: { request: copy(command.request), bodyBytes: { request: requireKnown(command.bodyBytes, "bytes") } } };
        send(command.source, command.target, work, (outcome) => { commandLive--; if (outcome === "completed") commandCompleted++; else commandFailed++; const reply = work.message?.response ?? null; if (commandResults.length < Math.min(i.limits.maxRawResults, SYSTEM_LIMITS.events) && resultFits(reply)) commandResults.push({ id: command.id, at: kernel.now, outcome, reply: copy(reply) }); else commandOmitted++; });
      });
      return security.hook(path, send);
    },
    receive(target, work, done) {
      const probe = instrumentation.get(target); if (!probe || (work.message?.request as { kind?: string } | undefined)?.kind !== "observe") return;
      const state = context.observe(target) as Record<string, unknown>, values = Object.fromEntries(["paused", "received", "admitted", "rejected", "completed", "failed", "queued", "serving", "waiting", "consumedCoreUs"].map((key) => [key, state[key]]));
      if (extension) { const cpu = (state.compute as { cpu?: { availableCoreUs: number; appCoreUs: number; competitorCoreUs: number } } | undefined)?.cpu; if (cpu) { values.availableCoreUs = cpu.availableCoreUs; values.totalCoreUs = cpu.appCoreUs + cpu.competitorCoreUs; } }
      const measuredAt = runtimeNow(); probe.produced++; observations.add(measuredAt, "measurement", target, "actual instrumented station snapshot");
      work.message!.response = { ok: true, measurementAt: measuredAt, values: { ...values, endpoint: context.endpoint(target) } }; work.message!.bodyBytes = { response: probe.bytes }; done("completed");
      return { admitted: true, state: () => "finished", cancel: () => "already-finished" } satisfies Receipt;
    },
  });
  function runtimeNow() { return clock.now; }
  return { horizon: runtime.horizon, advanceTo: runtime.advanceTo, evidence() {
    const e = runtime.evidence(), ids = new Set(i.resources.filter(isSystem).map((r) => r.id));
    return { ...e, workloadVersion: "m2g/1" as const, computeConfiguration: e.computeConfiguration.filter((r) => !ids.has(r.id)), systemConfiguration: copy({ resources: i.resources.filter(isSystem), ...i.systems }), systems: copy({ authorities: [...authorities.values()].map((s) => s.evidence()), resolvers: [...resolvers.values()].map((s) => s.evidence()), cdns: [...cdns.values()].map((s) => s.evidence()), registries: [...registries.values()].map((s) => s.evidence()), clients: [...clients.values()].map((s) => s.evidence()), monitors: [...monitors.values()].map((s) => s.evidence()), backends: [...backends.values()].map((s) => s.evidence()), security: security.evidence(), assessment: security.assessment(), instrumentation: [...instrumentation.entries()].map(([target, p]) => ({ target, ...p })), observations: observations.snapshot(), commands: { offered: commandOffered, live: commandLive, completed: commandCompleted, failed: commandFailed, omitted: commandOmitted, results: commandResults }, policyLedger: SYSTEM_POLICY_LEDGER }), unmodeled: [...e.unmodeled.filter((s) => s !== "DNS/NAT/ephemeral ports"), "DNS delegation/CNAME/AAAA/DNSSEC/NAT", "TLS cryptographic processing/framing/revocation/mTLS", "full HTTP cache/OCI/observability protocols", "target instrumentation CPU and physical telemetry persistence"] };
  } };
}
