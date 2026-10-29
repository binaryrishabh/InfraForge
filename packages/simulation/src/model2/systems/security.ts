import { requireKnown } from "../../reality/quantity";
import { copy } from "./copy";
import type { NetworkContext } from "../network/run";
import type { ConnectionHook, PathConfig, Trace } from "../network/contracts";
import type { Invocation, Receipt, RemoteOutcome } from "../workload/contracts";
import type { EventKernel } from "../time";
import type { DialConfig, DnsReply, FirewallRule, Scope, SystemsInput } from "./contracts";
import { utf8Bytes } from "../time";
import { eventRows, SYSTEM_LIMITS } from "./policy";
export const ipv4 = (address: string): number | undefined => {
  const parts = address.split("."); if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || +p > 255)) return;
  return parts.reduce((value, part) => (value * 256) + +part, 0) >>> 0;
};
export function securityPlane(input: SystemsInput, kernel: EventKernel, context: NetworkContext, peek: (resolver: string, name: string) => DnsReply | undefined, trace?: Trace) {
  const identities = new Map(input.systems.identities.map((i) => [i.id, i])), paths = new Map(input.paths.map((p) => [p.id, p])), listeners = new Map(input.systems.listeners.map((l) => [JSON.stringify([l.resource, l.protocol, requireKnown(l.port, "count")]), l]));
  const sortRules = (rules: FirewallRule[]) => [...rules].sort((a, b) => requireKnown(a.priority, "count") - requireKnown(b.priority, "count") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const policies = new Map(input.systems.firewalls.map((f) => [f.id, { config: f, rules: sortRules(f.rules), flows: new Map<string, { source: string; target: string; port: number; at: number }>(), evaluated: 0, allowed: 0, denied: 0, opened: 0, closed: 0, examined: 0, returns: 0, generation: 1 }]));
  const sessions = new Map<string, { path: string; target: string; tls: boolean; policies: string[] }>(), events = eventRows();
  const opted = input.securityProfile === "canvas-security/1";
  type Admission = { at: number; connectionId: string; path: string; source: string; target: string; port: number; reason: string; allowed: boolean; firewall?: string; rule?: string; direction?: string; generation?: number; defaultAction?: string };
  const admissions: Admission[] = []; let omitted = 0, admissionBytes = 0;
  const edgeCounts = new Map(input.paths.map(p => [p.id, { path: p.id, source: p.source, target: p.target, admitted: 0, denied: 0, noListener: 0, backendDeliveries: 0, lastDenial: undefined as Admission | undefined, policyDenied: {} as Record<string, number> }]));
  const record = (row: Admission) => {
    const c = edgeCounts.get(row.path)!;
    if (row.allowed) c.admitted++; else { c.denied++; c.lastDenial = row; if (row.reason === "no-listener") c.noListener++; if (row.firewall) { const key = `${row.firewall}:${row.direction}:${row.rule ?? "default"}`; c.policyDenied[key] = (c.policyDenied[key] ?? 0) + 1; } }
    const bytes = utf8Bytes(JSON.stringify(row));
    if (admissions.length >= Math.min(SYSTEM_LIMITS.events, input.limits.maxTraceRows) || admissionBytes + bytes > (input.limits.maxTraceBytes ?? Infinity)) { omitted++; return; }
    admissions.push(row); admissionBytes += bytes;
    trace?.(row.allowed ? "security-admitted" : "security-denied", row.connectionId, JSON.stringify(row));
  };
  const pending = new Set<string>();
  let attempts = 0, established = 0, failed = 0, cancelled = 0, closed = 0, tlsAttempts = 0, tlsEstablished = 0, tlsFailed = 0, dnsAttempts = 0, dnsFailed = 0;
  const matches = (scope: Scope, id: string) => {
    const identity = identities.get(id)!; if (scope.kind === "any") return true; if (scope.kind === "identity") return scope.value === id; if (scope.kind === "zone") return scope.value === identity.zone;
    const [address, prefix] = scope.value!.split("/"), value = ipv4(identity.address)!, network = ipv4(address!)!, bits = Number(prefix), mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (network & mask);
  };
  const ruleDecision = (policy: NonNullable<ReturnType<typeof policies.get>>, source: string, target: string, port: number, count: boolean) => {
    for (const direction of ["egress", "ingress"] as const) {
      let action = policy.config.default, matched = "default", matchedRule: string | undefined;
      for (const rule of policy.rules) {
        if (count) policy.examined++;
        if ((rule.direction === direction || rule.direction === "both") && rule.protocol === "tcp" && port >= requireKnown(rule.fromPort, "count") && port <= requireKnown(rule.toPort, "count") && matches(rule.source, source) && matches(rule.destination, target)) { action = rule.action; matched = opted ? rule.authoredId ?? rule.id : rule.id; matchedRule = matched; break; }
      }
      if (action === "deny") return { allowed: false, rule: `${direction}:${matched}`, direction, matchedRule };
    }
    return { allowed: true, rule: "both-directions-permitted" };
  };
  const inspect = (dial: DialConfig, path: PathConfig, count: boolean) => {
    const port = requireKnown(dial.port, "count");
    for (const id of dial.firewalls) {
      const p = policies.get(id)!, decision = ruleDecision(p, path.source, path.target, port, count);
      if (count) { p.evaluated++; if (decision.allowed) p.allowed++; else p.denied++; }
      if (!decision.allowed) return { ok: false, reason: `policy-denied:${id}:${decision.rule}`, firewall: id, direction: decision.direction, rule: decision.matchedRule, generation: p.generation, ...(decision.matchedRule === undefined ? { defaultAction: p.config.default } : {}) };
      if (count && p.flows.size >= requireKnown(p.config.maxFlows, "count")) return { ok: false, reason: `flow-capacity:${id}` };
    }
    const listener = listeners.get(JSON.stringify([path.target, dial.protocol, port]));
    if (!listener) return { ok: false, reason: "no-listener" };
    const endpoint = context.endpoint(path.target); if (!endpoint.alive || !endpoint.ready) return { ok: false, reason: "endpoint-not-ready" };
    if (!context.reachable(path.id)) return { ok: false, reason: "route-unavailable" };
    if (dial.tls.mode === "plaintext") return listener.tls === "required" ? { ok: false, reason: "tls-required" } : { ok: true, reason: "plaintext" };
    const cert = listener.certificate;
    if (listener.tls === "plaintext" || !cert) return { ok: false, reason: "tls-not-supported" };
    if (!dial.tls.serverName || !cert.names.includes(dial.tls.serverName.toLowerCase())) return { ok: false, reason: "certificate-name" };
    if (!dial.tls.trustedIssuers.includes(cert.issuer)) return { ok: false, reason: "certificate-trust" };
    if (kernel.now < requireKnown(cert.notBefore, "us") || kernel.now >= requireKnown(cert.notAfter, "us")) return { ok: false, reason: "certificate-time" };
    return { ok: true, reason: "authenticated-tls" };
  };
  return {
    hook(path: PathConfig, send: (source: string, target: string, work: Invocation, done: (outcome: RemoteOutcome) => void) => Receipt): ConnectionHook {
      const dial = input.systems.connections.find((c) => c.path === path.id)!;
      return {
        ...(opted ? { securityEvidence: true as const, delivered: () => { edgeCounts.get(path.id)!.backendDeliveries++; } } : {}),
        open(id, done) {
          attempts++; pending.add(id); let stopped = false, receipt: Receipt | undefined;
          const admit = (selected: PathConfig) => {
            if (stopped) return; pending.delete(id);
            const result = inspect(dial, selected, true);
            if (opted) record({ at: kernel.now, connectionId: id, path: path.id, source: selected.source, target: selected.target, port: requireKnown(dial.port, "count"), allowed: result.ok && sessions.size < SYSTEM_LIMITS.flows, reason: result.reason, ...("firewall" in result ? { firewall: result.firewall, direction: result.direction, rule: result.rule, generation: result.generation, ...("defaultAction" in result ? { defaultAction: result.defaultAction } : {}) } : {}) });
            if (!result.ok || sessions.size >= SYSTEM_LIMITS.flows) { failed++; if (result.reason.startsWith("tls") || result.reason.startsWith("certificate")) { tlsAttempts++; tlsFailed++; } events.add(kernel.now, "connection-denied", id, result.reason); done(undefined, "backend-rejected"); return; }
            for (const policy of dial.firewalls) { const p = policies.get(policy)!; p.flows.set(id, { source: selected.source, target: selected.target, port: requireKnown(dial.port, "count"), at: kernel.now }); p.opened++; }
            const tls = dial.tls.mode === "authenticated"; sessions.set(id, { path: path.id, target: selected.target, tls, policies: [...dial.firewalls] }); established++; if (tls) { tlsAttempts++; tlsEstablished++; }
            events.add(kernel.now, "connection-admitted", id, `${selected.target}:${result.reason}`); done({ target: selected.target, request: [...selected.request], response: [...selected.response] });
          };
          if (!dial.dns) admit(path);
          else {
            dnsAttempts++; const work: Invocation = { rootId: JSON.stringify(["dial", id]), callId: JSON.stringify(["dial", id]), attempt: 1, operation: input.systems.operation, offeredAt: kernel.now, message: { request: { kind: "resolve", name: dial.dns.name } } };
            receipt = send(path.source, dial.dns.resolver, work, (outcome) => {
              if (stopped) return; const answer = work.message!.response as DnsReply | undefined, route = answer?.ok && outcome === "completed" ? dial.dns!.routes.find((r) => r.address === answer.addresses?.[0]) : undefined;
              if (!route) { pending.delete(id); dnsFailed++; failed++; events.add(kernel.now, "dns-connect-failed", id, answer?.reason ?? "resolution-failed-or-unroutable"); done(undefined, "backend-rejected"); return; }
              admit(paths.get(route.path)!);
            });
          }
          return () => { if (stopped) return false; stopped = true; if (pending.delete(id)) cancelled++; receipt?.cancel(); return true; };
        },
        close(id) { const session = sessions.get(id); if (!session) return; sessions.delete(id); closed++; for (const policy of session.policies) { const p = policies.get(policy)!; if (p.flows.delete(id)) p.closed++; } },
        returnTraffic(id) { const session = sessions.get(id); if (!session) return false; for (const policy of session.policies) policies.get(policy)!.returns++; return true; },
      };
    },
    update(id: string, rules: FirewallRule[]) { const p = policies.get(id)!; p.rules = sortRules(copy(rules)); p.generation++; events.add(kernel.now, "policy-updated", id, "existing admitted flows retained"); if (opted) trace?.("security-policy-updated", id, JSON.stringify({ firewall: id, generation: p.generation, retainedFlows: p.flows.size })); },
    assessment() {
      const probes = input.systems.connections.filter((d) => identities.get(paths.get(d.path)!.source)!.zone === "external").map((dial) => {
        const original = paths.get(dial.path)!, answer = dial.dns ? peek(dial.dns.resolver, dial.dns.name) : undefined, route = dial.dns ? dial.dns.routes.find((r) => r.address === answer?.addresses?.[0]) : undefined;
        const selected = dial.dns ? route ? paths.get(route.path) : undefined : original;
        const decision = selected ? inspect(dial, selected, false) : { ok: false, reason: "resolution-required" };
        return { path: dial.path, target: selected?.target ?? original.target, port: requireKnown(dial.port, "count"), reachable: selected ? decision.ok : "Unknown", reason: decision.reason, transport: dial.tls.mode };
      });
      const findings = probes.flatMap((p) => {
        const out: Array<{ path: string; target: string; kind: string }> = [], add = (kind: string) => out.push({ path: p.path, target: p.target, kind });
        if (p.reachable === true) { if (input.resources.find((r) => r.id === p.target)?.kind === "relational") add("internet-reachable-db"); if (p.port === 22) add("external-ssh-listener"); if (p.transport === "plaintext") add("plaintext-reachable-service"); }
        if (p.reason === "no-listener") add("allowed-port-without-listener"); if (p.reason.startsWith("policy-denied")) add("policy-blocked-path"); if (p.reason.startsWith("tls") || p.reason.startsWith("certificate")) add(p.reason); return out;
      });
      return { scope: "Configured external routes/listeners/policy/readiness; hostname needs a current observed answer", probes, findings, resources: input.resources.map((r) => { const ps = probes.filter((p) => p.target === r.id); return { id: r.id, internetReachability: ps.some((p) => p.reachable === true) ? "reachable" : ps.some((p) => p.reachable === "Unknown") ? "Unknown" : "blocked", reason: ps.length ? "derived-from-probes" : "no-external-path" }; }) };
    },
    metrics: () => opted ? ({ edges: [...edgeCounts.values()].map(c => ({ ...c, policyDenied: { ...c.policyDenied } })), policies: [...policies.entries()].map(([id,p]) => ({ id, generation: p.generation, occupancy: p.flows.size, limit: requireKnown(p.config.maxFlows, "count"), admissions: p.opened })), omitted }) : undefined,
    evidence: () => ({ ...(opted ? { admission: { rows: admissions.map(r => ({ ...r })), omitted, bytes: admissionBytes }, edges: [...edgeCounts.values()].map(c => ({ ...c, policyDenied: { ...c.policyDenied } })) } : {}), attempts, established, failed, cancelled, pending: pending.size, closed, tlsAttempts, tlsEstablished, tlsFailed, dnsAttempts, dnsFailed, sessions: [...sessions.entries()].map(([id, value]) => ({ id, ...value })), policies: [...policies.entries()].map(([id, p]) => ({ id, generation: p.generation, evaluated: p.evaluated, allowed: p.allowed, denied: p.denied, opened: p.opened, closed: p.closed, rulesExamined: p.examined, returnExchanges: p.returns, rules: copy(p.rules), flows: [...p.flows.entries()].map(([id, flow]) => ({ id, ...flow })) })), events: events.snapshot(), tlsPhysicalDemand: "Unknown; semantic authentication gate only" }),
  };
}
