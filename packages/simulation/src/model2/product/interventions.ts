import { INTERVENTIONS, interventionError, type InterventionRequest, type InterventionTarget } from "@infraforge/domain/resource";
import type { InterventionReceipt, InterventionOption } from "@infraforge/contracts/actions";
import type { ProductContract, SavedProductDesign } from "./contracts";
import type { SystemsInput } from "../systems/contracts";
import type { derivedLedger } from "./provenance";
import { requireKnown } from "../../reality/quantity";
const SECOND = 1_000_000;
// Only declared primary mechanism roles and already materialized directed paths are selectable.
// Fixed roles stay fixed; a lifecycle-controlled role cannot silently select a new generation.
export function resolveIntervention(design: SavedProductDesign, contract: ProductContract, input: SystemsInput, request: InterventionRequest): InterventionOption {
  const d = INTERVENTIONS.find(d => d.id === request.interventionId && d.revision === request.revision);
  if (!d) throw Error("INTERVENTION_REVISION: unavailable revision");
  const target = request.target;
  let resolvedTargets: string[], authoredBaseline: number | undefined;
  if ("resourceId" in target) {
    const spec = contract.nodes[target.resourceId], resource = design.resources.find(r => r.id === target.resourceId);
    const role = spec?.resources.find(r => r.role === spec.primary), material = input.resources.find(r => r.id === target.resourceId);
    if (d.id === "deny-port") {
      if (!resource || resource.type !== "Firewall" || !spec?.firewall || spec.controller || !input.systems.firewalls.some(f => f.id === resource.id)) throw Error("INTERVENTION_ROLE: fixed firewall policy required");
      resolvedTargets = [resource.id];
    } else {
      if (!resource || resource.type !== d.targetKind || !spec || spec.controller || role?.config.kind !== d.mechanism || material?.kind !== d.mechanism) throw Error("INTERVENTION_ROLE: target lacks a fixed declared mechanism role");
      if (d.id === "cpu-capacity" || d.id === "session-capacity") {
        if (material.kind !== "relational") throw Error("INTERVENTION_ROLE: relational execution required");
        authoredBaseline = d.id === "cpu-capacity" ? requireKnown(material.execution.cores, "cores") : requireKnown(material.maxSessions, "count");
      }
      resolvedTargets = [material.id];
    }
  } else {
    if (d.targetKind !== "edge" || !design.connections.some(e => e.id === target.edgeId)) throw Error("INTERVENTION_PATH: semantic edge is absent");
    const edge = design.connections.find(e => e.id === target.edgeId)!, binding = contract.edges[edge.id]!;
    // Reconstruct the exact compiler key from explicit endpoints and declared roles.
    const instance = (endpoint: string, node: string, role: string) => role === contract.nodes[node]!.primary ? endpoint : endpoint.slice(0, -(role.length + 1));
    const paths = input.paths.filter(p => {
      const source = binding.purpose === "queue-poll" ? p.target : p.source, destination = binding.purpose === "queue-poll" ? p.source : p.target;
      return p.id === `${edge.id}:${instance(source, edge.sourceId, binding.sourceRole)}:${instance(destination, edge.targetId, binding.targetRole)}`;
    });
    if (d.id === "pool-reset" && [edge.sourceId, edge.targetId].some(id => contract.nodes[id]?.controller)) throw Error("INTERVENTION_GENERATION: fixed endpoint generations required");
    resolvedTargets = d.id === "pool-reset" ? paths.map(p => p.id).sort() : [...new Set(paths.flatMap(p => target.direction === "both" ? [...p.request, ...p.response] : p[target.direction]))].sort();
    if (!resolvedTargets.length || resolvedTargets.some(id => !(d.id === "pool-reset" ? input.paths : input.links).some(l => l.id === id))) throw Error("INTERVENTION_PATH: edge has no materialized transport links");
  }
  const affectedPaths = input.paths.filter(p => d.id === "deny-port" ? input.systems.connections.some(c => c.path === p.id && requireKnown(c.port, "count") === Number(request.parameters.port) && c.firewalls.some(id => resolvedTargets.includes(id))) : d.id === "pool-reset" ? resolvedTargets.includes(p.id) : [...p.request, ...p.response].some(id => resolvedTargets.includes(id))).map(p => p.id).sort();
  if (resolvedTargets.length > 2048 || affectedPaths.length > 2048) throw Error("INTERVENTION_BUDGET: resolved blast radius exceeds receipt budget");
  return {interventionId: d.id, revision: d.revision, target, ...(authoredBaseline === undefined ? {} : {authoredBaseline}), resolvedTargets, affectedPaths};
}
export function interventionOptions(design: SavedProductDesign, contract: ProductContract, input: SystemsInput): InterventionOption[] {
  const result: InterventionOption[] = [];
  for (const d of INTERVENTIONS) {
    const targets: InterventionTarget[] = d.targetKind === "edge" ? design.connections.flatMap(e => (d.directions ?? ["request", "response", "both"] as const).map(direction => ({edgeId: e.id, direction})))
      : design.resources.filter(r => r.type === d.targetKind).map(r => ({resourceId: r.id}));
    for (const target of targets) {
      const sample = {interventionId: d.id, revision: d.revision, target, parameters: Object.fromEntries(d.parameters.map(p => [p.name, p.min ?? (p.kind === "boolean" ? false : p.values?.[0] ?? 0)]))};
      if (interventionError(sample)) continue;
      try { result.push(resolveIntervention(design, contract, input, sample)); }
      catch { /* Unsupported roles/paths are unavailable, never zero capacity. */ }
    }
  }
  return result;
}
export function incomingMaterializedLinks(input: SystemsInput, node: string): string[] {
  const owns = (id: string) => id === node || id.startsWith(`${node}/`) || id.startsWith(`${node}#`);
  return input.links.filter(l => owns(l.to)).map(l => l.id).sort();
}
export function compileInterventions(design: SavedProductDesign, contract: ProductContract, input: SystemsInput, provenance: ReturnType<typeof derivedLedger>): InterventionReceipt[] {
  const rows = contract.interventions ?? [];
  if (rows.length > 20) throw Error("INTERVENTION_BUDGET: at most 20 actions");
  const receipts: InterventionReceipt[] = [], ids = new Set<string>();
  for (const row of rows) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(row.id) || ids.has(row.id) || !Number.isSafeInteger(row.atUs) || row.atUs < 0) throw Error("INTERVENTION_ID: unique action and whole-microsecond time required");
    ids.add(row.id);
    const shapeError = interventionError(row.request); if (shapeError) throw Error(shapeError);
    const option = resolveIntervention(design, contract, input, row.request);
    const error = interventionError(row.request, {authoredBaseline: option.authoredBaseline, remainingSeconds: Math.floor((requireKnown(input.horizon, "us") - row.atUs) / SECOND)});
    if (error) throw Error(error);
    if (row.atUs > requireKnown(input.horizon, "us")) throw Error("INTERVENTION_HORIZON: action is outside the run");
    const {interventionId: kind, parameters} = row.request;
    const durationUs = INTERVENTIONS.find(d => d.id === kind)!.endPolicy === "one-shot" ? undefined : Number(parameters.duration) * SECOND, endUs = durationUs === undefined ? null : row.atUs + durationUs;
    if (kind === "consumer-outage") {
      // Reject saved availability changes too: their restore callbacks must never
      // override this window or establish an ambiguous baseline at its start.
      if (input.asyncInterventions.some(i => i.kind === "consumer-state" && option.resolvedTargets.includes(i.target) && requireKnown(i.at, "us") < endUs! && requireKnown(i.at, "us") + requireKnown(i.duration, "us") > row.atUs)) throw Error("INTERVENTION_OVERLAP: existing consumer availability control");
      if (contract.faults.some(f => f.kind === "Crash" && option.resolvedTargets.includes(f.target) && requireKnown(f.at, "us") < endUs! && requireKnown(f.at, "us") + requireKnown(f.duration, "us") + (f.restart ? requireKnown(f.restart, "us") : 0) > row.atUs)
        || input.networkInterventions.some(i => i.kind === "service-state" && option.resolvedTargets.includes(i.target) && requireKnown(i.at, "us") < endUs! && requireKnown(i.at, "us") + requireKnown(i.duration, "us") > row.atUs)) throw Error("INTERVENTION_GENERATION: consumer outage overlaps endpoint state or replacement");
    }
    if (kind === "pool-reset") {
      const paths = input.paths.filter(p => option.resolvedTargets.includes(p.id));
      const owns = (endpoint: string, node: string) => endpoint === node || endpoint.startsWith(`${node}/`) || endpoint.startsWith(`${node}#`);
      if (contract.faults.some(f => f.kind === "Crash" && paths.some(p => owns(p.source, f.target) || owns(p.target, f.target)) && requireKnown(f.at, "us") <= row.atUs && requireKnown(f.at, "us") + requireKnown(f.duration, "us") + (f.restart ? requireKnown(f.restart, "us") : 0) >= row.atUs)
        || input.networkInterventions.some(i => i.kind === "service-state" && !i.alive && paths.some(p => p.source === i.target || p.target === i.target) && requireKnown(i.at, "us") <= row.atUs && requireKnown(i.at, "us") + requireKnown(i.duration, "us") >= row.atUs)) throw Error("INTERVENTION_GENERATION: pool reset overlaps endpoint replacement");
      if (input.networkInterventions.some(i => i.kind === "reset" && option.resolvedTargets.includes(i.target) && requireKnown(i.at, "us") === row.atUs)) throw Error("INTERVENTION_OVERLAP: duplicate pool reset at one timestamp");
    }
    // Includes physical sharing, direction aliases and legacy network controls.
    for (const old of receipts) if (old.interventionId === kind && old.resolvedTargets.some(id => option.resolvedTargets.includes(id)) && old.endUs !== null && endUs !== null && row.atUs < old.endUs && endUs > old.atUs) throw Error("INTERVENTION_OVERLAP: same mechanism and materialized target");
    if (endUs !== null && input.networkInterventions.some(i => i.kind === "service-state" && !i.alive && option.resolvedTargets.includes(i.target) && requireKnown(i.at, "us") < endUs && requireKnown(i.at, "us") + requireKnown(i.duration, "us") > row.atUs)) throw Error("INTERVENTION_GENERATION: capacity control overlaps a process restart");
    for (const id of option.resolvedTargets) {
      if (input.networkInterventions.some(i => i.kind === kind && i.target === id && "duration" in i && endUs !== null && requireKnown(i.at, "us") < endUs && requireKnown(i.at, "us") + requireKnown(i.duration, "us") > row.atUs)) throw Error("INTERVENTION_OVERLAP: existing transport control");
    }
    const q = <U extends "us" | "count" | "cores">(name: string, value: number, unit: U) => provenance.q(`intervention.${row.id}.${name}`, value, unit, [`intervention ${kind}@${row.request.revision}: ${name}; product policy bounds`], "user-input");
    const at = q("at", row.atUs, "us"), duration = durationUs === undefined ? undefined : q("duration", durationUs, "us");
    for (const target of option.resolvedTargets) {
      const common = {id: `${row.id}:${target}`, at, target};
      if (kind === "deny-port") {
        const baseline = input.systems.firewalls.find(f => f.id === target)!;
        if (baseline.rules.some(r => requireKnown(r.priority, "count") < 0) || input.systems.interventions.some(i => i.kind === "firewall-rules" && i.target === target && !receipts.some(r => i.id === `${r.actionId}:${target}:start` || i.id === `${r.actionId}:${target}:restore`))) throw Error("INTERVENTION_OVERLAP: ambiguous saved policy update");
        const ruleId = `intervention:${row.id}:deny-port`;
        if (baseline.rules.some(r => r.id === ruleId)) throw Error("INTERVENTION_OVERLAP: intervention rule identity conflict");
        // Opt in only for this run; inferred allow-all baselines remain untouched otherwise.
        input.securityProfile = "canvas-security/1";
        input.systems.interventions.push({...common, id: `${common.id}:start`, kind: "firewall-rules", rules: [...baseline.rules, {
          id: ruleId, direction: "both", protocol: "tcp", source: {kind: "any"}, destination: {kind: "any"},
          fromPort: q("port", Number(parameters.port), "count"), toPort: q("portEnd", Number(parameters.port), "count"), priority: provenance.q(`intervention.${row.id}.priority`, -1, "count", ["deny-port@1: reserved priority ahead of nonnegative baseline rules"], "implementation-policy"), action: "deny",
        }]}, {...common, id: `${common.id}:restore`, at: q("restore", endUs!, "us"), kind: "firewall-rules", restore: true, rules: baseline.rules});
      }
      else if (kind === "consumer-outage") input.asyncInterventions.push({...common, kind: "consumer-state", available: false, duration: duration!});
      else if (kind === "pool-reset") input.networkInterventions.push({...common, kind: "reset", evidenceActionId: row.id});
      else if (kind === "flush") input.dataInterventions.push({...common, kind});
      else if (kind === "session-capacity") input.dataInterventions.push({...common, kind, duration: duration!, sessions: q("sessions", Number(parameters.sessions), "count")});
      else if (kind === "cpu-capacity") input.dataInterventions.push({...common, kind, duration: duration!, cores: q("cores", Number(parameters.cores), "cores")});
      else if (kind === "delay" || kind === "partition" || kind === "bandwidth") {
        // Each materialized link retains an exact sourced delay quantity.
        const delay = kind === "delay" ? provenance.q(`intervention.${row.id}.delay.${input.networkInterventions.length}`, Number(parameters.delay), "us", [`intervention delay@1; product policy`], "user-input") : undefined;
        const bandwidth = kind === "bandwidth" ? provenance.q(`intervention.${row.id}.bandwidth.${input.networkInterventions.length}`, Number(parameters.bandwidth), "bytes/s", ["intervention bandwidth@1; product policy"], "user-input") : undefined;
        input.networkInterventions.push(kind === "bandwidth" ? {...common, kind, duration: duration!, bandwidth: bandwidth!} : kind === "delay" ? {...common, kind, duration: duration!, delay: delay!} : {...common, kind, duration: duration!});
      } else throw Error("INTERVENTION_ADAPTER: no real mechanism adapter");
    }
    receipts.push({...row.request, actionId: row.id, resolvedTargets: option.resolvedTargets, affectedPaths: option.affectedPaths, atUs: row.atUs, endUs});
  }
  return receipts;
}
