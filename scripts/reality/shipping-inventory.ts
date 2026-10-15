import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { RESOURCE_TYPES } from "../../packages/domain/src/resource/RESOURCE_TYPES.constants";
export const shippingRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export type ShippingStatus = "REAL" | "PARTIAL" | "MODEL1_ONLY" | "UNKNOWN" | "REMOVE_BEFORE_MODEL2_SHIP";
export interface Surface { id: string; source: string; identity: string; description: string; kind: "field" | "resource" | "chaos" | "control" | "display" }
export interface ShippingEntry extends Surface { resources: string[]; model1Meaning: string; model2Owner: string; changesState: boolean; effects: { physics: boolean; reachability: boolean; security: boolean; cost: boolean; evidence: boolean }; provenanceRequirements: string[]; status: ShippingStatus; finalProductEligible: boolean; plan: string }
export function scanSurface(source: string, text: string): Surface[] {
  const file = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true, source.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS), rows: Surface[] = [], occurrences = new Map<string, number>();
  const add = (kind: Surface["kind"], identity: string, description = identity) => { const count = occurrences.get(identity) ?? 0; occurrences.set(identity, count + 1); rows.push({ id: `${kind}:${source}:${identity}:${count}`, source, identity, description, kind }); };
  const visit = (node: ts.Node) => {
    if (ts.isInterfaceDeclaration(node) && ["Resource", "AutoscalingPolicy", "ConnectionLine", "WorkloadProfile"].includes(node.name.text)) for (const member of node.members) if (ts.isPropertySignature(member) && member.name) add("field", `${node.name.text}.${member.name.getText(file)}`);
    if (ts.isEnumDeclaration(node) && node.name.text === "DeploymentChaosNames") for (const member of node.members) add("chaos", member.name.getText(file));
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file), attributes = node.attributes.properties.filter(ts.isJsxAttribute), active = /^(input|select|textarea|button|Switch|Select|Input|Button|IconButton|Segmented)$/.test(tag) || attributes.some((a) => /^(on[A-Z]|value$|checked$)/.test(a.name.getText(file)));
      if (active) { const owner = ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent : node; const normalized = owner.getText(file).replace(/\s+/g, " "); const bindings = attributes.filter((a) => /^(on[A-Z]|value$|checked$|label$|aria-label$)/.test(a.name.getText(file))).map((a) => a.getText(file)).join(" "); add("control", `${tag}-${createHash("sha256").update(normalized).digest("hex").slice(0, 20)}`, `${tag}: ${bindings || normalized}`.slice(0, 800)); }
    }
    if (ts.isJsxExpression(node) && node.expression && /\b(resource|metrics|stats|snapshot|finding|cost|capacity|simulation|rps|cpu|memory|latency|replica)\b/i.test(node.expression.getText(file))) add("display", createHash("sha256").update(node.expression.getText(file).replace(/\s+/g, " ")).digest("hex").slice(0, 20), node.expression.getText(file).replace(/\s+/g, " ").slice(0, 800));
    ts.forEachChild(node, visit);
  }; visit(file); return rows;
}
export function visibleSurfaces(root = shippingRoot): Surface[] {
  const files: string[] = [];
  const walk = (directory: string) => { for (const entry of readdirSync(directory, { withFileTypes: true })) { const path = resolve(directory, entry.name); if (entry.isDirectory()) walk(path); else if (entry.name.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(entry.name)) files.push(path); } };
  walk(resolve(root, "apps/web/src"));
  for (const f of ["packages/domain/src/resource/Resource.interface.ts", "packages/domain/src/resource/AutoscalingPolicy.interface.ts", "packages/domain/src/resource/ConnectionLine.interface.ts", "packages/domain/src/resource/DeploymentChaosNames.enum.ts", "packages/domain/src/workload/WorkloadProfile.interface.ts"]) if (existsSync(resolve(root, f))) files.push(resolve(root, f));
  const rows = files.flatMap((path) => { const file = relative(root, path).replaceAll("\\", "/"); return scanSurface(file, readFileSync(path, "utf8")); });
  for (const resource of Object.values(RESOURCE_TYPES)) rows.push({ id: `resource:${resource}`, source: "packages/domain/src/resource/RESOURCE_TYPES.constants.ts", identity: resource, description: `Visible ${resource} resource placement and type-specific Model-1 behavior`, kind: "resource" });
  // These persisted fields remain tracked even when only historical designs expose them.
  return rows.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function validateShipping(entries: ShippingEntry[], surfaces = visibleSurfaces(), root = shippingRoot) {
  const errors: string[] = [], ids = new Set(entries.map((e) => e.id));
  if (ids.size !== entries.length) errors.push("Duplicate shipping inventory identity");
  for (const surface of surfaces) if (!ids.has(surface.id)) errors.push(`Inventory gap: ${surface.id}`);
  const actual = new Set(surfaces.map((s) => s.id));
  for (const entry of entries) {
    if (!actual.has(entry.id)) errors.push(`Stale inventory identity: ${entry.id}`);
    if (!["REAL", "PARTIAL", "MODEL1_ONLY", "UNKNOWN", "REMOVE_BEFORE_MODEL2_SHIP"].includes(entry.status) || !entry.resources.length || !entry.model1Meaning.trim() || !entry.model2Owner.trim() || !entry.provenanceRequirements.length || !entry.plan.trim() || !entry.effects || Object.values(entry.effects).some((x) => typeof x !== "boolean")) errors.push(`Incomplete inventory entry: ${entry.id}`);
    if (entry.finalProductEligible && (entry.status !== "REAL" || !entry.changesState || !existsSync(resolve(root, entry.model2Owner)))) errors.push(`Unsupported shipping eligibility: ${entry.id}`);
  }
  return errors;
}
export const unshippable = (entries: ShippingEntry[]) => entries.filter((e) => !e.finalProductEligible || e.status !== "REAL");
export function newInventoryEntry(surface: Surface): ShippingEntry {
  return { ...surface, resources: ["ALL"], model1Meaning: "New visible surface requires explicit semantic review", model2Owner: "UNASSIGNED", changesState: false, effects: { physics: false, reachability: false, security: false, cost: false, evidence: false }, provenanceRequirements: ["Trace input to state owner and downstream proof; record units/domain for numeric values"], status: "UNKNOWN", finalProductEligible: false, plan: "Implement and prove the real mechanism or remove before Model-2 shipping" };
}
export function shippingInventory(root = shippingRoot) { return JSON.parse(readFileSync(resolve(root, "docs/reality/shipping-reality.json"), "utf8")) as { schema: string; entries: ShippingEntry[] }; }
if (import.meta.main) {
  const file = resolve(shippingRoot, "docs/reality/shipping-reality.json"), surfaces = visibleSurfaces(), previous = existsSync(file) ? shippingInventory().entries : [], byId = new Map(previous.map((e) => [e.id, e]));
  if (process.argv.includes("--write")) writeFileSync(file, JSON.stringify({ schema: "infraforge-shipping-reality/1", scope: "Every declared infrastructure field/resource/chaos option and scanned web interactive/technical display surface; normal Model-1 validation does not require Model-2 shipping readiness", entries: surfaces.map((s) => byId.has(s.id) ? { ...byId.get(s.id)!, ...s } : newInventoryEntry(s)) }, null, 2) + "\n");
  const entries = shippingInventory().entries, errors = validateShipping(entries), blocked = unshippable(entries);
  if (errors.length) throw Error(errors.join("\n"));
  console.log(JSON.stringify({ surfaces: entries.length, byStatus: Object.fromEntries(["REAL", "PARTIAL", "MODEL1_ONLY", "UNKNOWN", "REMOVE_BEFORE_MODEL2_SHIP"].map((status) => [status, entries.filter((e) => e.status === status).length])), model2ShippingReady: blocked.length === 0, blockedCount: blocked.length, ...(process.argv.includes("--blocked") ? { blocked } : {}) }));
  if (process.argv.includes("--ready") && blocked.length) { console.error("MODEL2_SHIPPING_READY refused: visible mechanisms remain incomplete"); process.exitCode = 1; }
}
