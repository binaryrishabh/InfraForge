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
    if (!resource || resource.type !== d.targetKind || !spec || spec.controller || role?.config.kind !== d.mechanism || material?.kind !== d.mechanism) throw Error("INTERVENTION_ROLE: target lacks a fixed declared mechanism role");
    if (d.id === "cpu-capacity" || d.id === "session-capacity") {
      if (material.kind !== "relational") throw Error("INTERVENTION_ROLE: relational execution required");
      authoredBaseline = d.id === "cpu-capacity" ? requireKnown(material.execution.cores, "cores") : requireKnown(material.maxSessions, "count");
    }
    resolvedTargets = [material.id];
  } else {
    if (d.targetKind !== "edge" || !design.connections.some(e => e.id === target.edgeId)) throw Error("INTERVENTION_PATH: semantic edge is absent");
    const paths = input.paths.filter(p => p.id.startsWith(`${target.edgeId}:`));
    resolvedTargets = [...new Set(paths.flatMap(p => target.direction === "both" ? [...p.request, ...p.response] : p[target.direction]))].sort();
    if (!resolvedTargets.length || resolvedTargets.some(id => !input.links.some(l => l.id === id))) throw Error("INTERVENTION_PATH: edge has no materialized transport links");
  }
  const affectedPaths = input.paths.filter(p => [...p.request, ...p.response].some(id => resolvedTargets.includes(id))).map(p => p.id).sort();
  if (resolvedTargets.length > 2048 || affectedPaths.length > 2048) throw Error("INTERVENTION_BUDGET: resolved blast radius exceeds receipt budget");
  return {interventionId: d.id, revision: d.revision, target, ...(authoredBaseline === undefined ? {} : {authoredBaseline}), resolvedTargets, affectedPaths};
}
export function interventionOptions(design: SavedProductDesign, contract: ProductContract, input: SystemsInput): InterventionOption[] {
  const result: InterventionOption[] = [];
  for (const d of INTERVENTIONS) {
    const targets: InterventionTarget[] = d.targetKind === "edge" ? design.connections.flatMap(e => (["request", "response", "both"] as const).map(direction => ({edgeId: e.id, direction})))
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
    const durationUs = kind === "flush" ? undefined : Number(parameters.duration) * SECOND, endUs = durationUs === undefined ? null : row.atUs + durationUs;
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
      if (kind === "flush") input.dataInterventions.push({...common, kind});
      else if (kind === "session-capacity") input.dataInterventions.push({...common, kind, duration: duration!, sessions: q("sessions", Number(parameters.sessions), "count")});
      else if (kind === "cpu-capacity") input.dataInterventions.push({...common, kind, duration: duration!, cores: q("cores", Number(parameters.cores), "cores")});
      else if (kind === "delay" || kind === "partition") {
        // Each materialized link retains an exact sourced delay quantity.
        const delay = kind === "delay" ? provenance.q(`intervention.${row.id}.delay.${input.networkInterventions.length}`, Number(parameters.delay), "us", [`intervention delay@1; product policy`], "user-input") : undefined;
        input.networkInterventions.push(kind === "delay" ? {...common, kind, duration: duration!, delay: delay!} : {...common, kind, duration: duration!});
      } else throw Error("INTERVENTION_ADAPTER: no real mechanism adapter");
    }
    receipts.push({...row.request, actionId: row.id, resolvedTargets: option.resolvedTargets, affectedPaths: option.affectedPaths, atUs: row.atUs, endUs});
  }
  return receipts;
}
