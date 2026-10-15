import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { RESOURCE_TYPES } from "../../packages/domain/src/resource/RESOURCE_TYPES.constants";
export const shippingRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export type ShippingStatus = "REAL" | "PARTIAL" | "MODEL1_ONLY" | "UNKNOWN" | "REMOVE_BEFORE_MODEL2_SHIP" | "NOT_APPLICABLE";
export const SURFACE_CATEGORIES = ["INFRA_INPUT", "INFRA_OUTPUT", "RESOURCE_TYPE", "WORKLOAD_INPUT", "FAULT_CONTROL", "SECURITY_CONTROL", "COST_INPUT_OR_OUTPUT", "PRODUCT_UI_ACTION", "PRESENTATION_ONLY", "UNREVIEWED"] as const;
export type SurfaceCategory = typeof SURFACE_CATEGORIES[number];
export interface Surface { id: string; source: string; identity: string; description: string; kind: "field" | "resource" | "chaos" | "control" | "display" }
export interface ShippingEntry extends Surface { category: SurfaceCategory; categoryReason: string; ui: { status: "VALID" | "REVIEW_REQUIRED" | "NOT_APPLICABLE"; behavior: string; proofs: string[] }; resources: string[]; model1Meaning: string; model2Owner: string; changesState: boolean; effects: { physics: boolean; reachability: boolean; security: boolean; cost: boolean; evidence: boolean }; provenanceRequirements: string[]; status: ShippingStatus; finalProductEligible: boolean; plan: string }
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
    if (!["REAL", "PARTIAL", "MODEL1_ONLY", "UNKNOWN", "REMOVE_BEFORE_MODEL2_SHIP", "NOT_APPLICABLE"].includes(entry.status) || !entry.resources.length || !entry.model1Meaning.trim() || !entry.model2Owner.trim() || !entry.provenanceRequirements.length || !entry.plan.trim() || !entry.effects || Object.values(entry.effects).some((x) => typeof x !== "boolean")) errors.push(`Incomplete inventory entry: ${entry.id}`);
    const uiOnly = ["PRODUCT_UI_ACTION", "PRESENTATION_ONLY"].includes(entry.category);
    if (!SURFACE_CATEGORIES.includes(entry.category) || !entry.categoryReason?.trim() || !entry.ui || !["VALID", "REVIEW_REQUIRED", "NOT_APPLICABLE"].includes(entry.ui.status)) errors.push(`Unreviewed surface taxonomy: ${entry.id}`);
    if ((entry.kind === "resource" && entry.category !== "RESOURCE_TYPE") || (entry.kind === "chaos" && entry.category !== "FAULT_CONTROL") || (entry.kind === "field" && /^(Resource\.(public|encryption|openPorts|skuId|autoscaling)|AutoscalingPolicy\.|WorkloadProfile\.|ConnectionLine\.(sourceId|targetId|port))/.test(entry.identity) && uiOnly)) errors.push(`Technical surface misclassified as UI: ${entry.id}`);
    if (uiOnly && entry.kind === "control" && /resource\.(public|encryption|openPorts|skuId|autoscaling)|policy\.(minReplicas|maxReplicas|targetCpu)|metric\.(cpu|memory|health)|profile\.(targetThroughput|readWriteRatio|payloadSize|trafficShape|peakMultiplier|throughputUnit)/.test(entry.description)) errors.push(`Technical binding misclassified as UI: ${entry.id}`);
    if ((uiOnly && entry.status !== "NOT_APPLICABLE") || (!uiOnly && entry.status === "NOT_APPLICABLE") || (uiOnly && entry.finalProductEligible && entry.ui.status !== "VALID")) errors.push(`Incorrect separate readiness eligibility: ${entry.id}`);
    if (entry.ui?.status === "VALID" && (!uiOnly || !entry.ui.behavior.trim() || !entry.ui.proofs.length || entry.ui.proofs.some((p) => !existsSync(resolve(root, p))))) errors.push(`Unsupported UI validity: ${entry.id}`);
    if (!uiOnly && entry.finalProductEligible && (entry.status !== "REAL" || (!entry.changesState && !entry.effects.evidence) || !entry.model2Owner.startsWith("packages/simulation/src/model2/") || !existsSync(resolve(root, entry.model2Owner)))) errors.push(`Unsupported shipping eligibility: ${entry.id}`);
  }
  return errors;
}
export const infrastructureSurface = (e: ShippingEntry) => !["PRODUCT_UI_ACTION", "PRESENTATION_ONLY"].includes(e.category);
export const unshippable = (entries: ShippingEntry[]) => entries.filter((e) => infrastructureSurface(e) && (!e.finalProductEligible || e.status !== "REAL" || e.category === "UNREVIEWED"));
export const invalidUi = (entries: ShippingEntry[]) => entries.filter((e) => !infrastructureSurface(e) && e.ui.status !== "VALID");
export function shippingSummary(entries: ShippingEntry[]) { return { surfaces: entries.length, byCategory: Object.fromEntries(SURFACE_CATEGORIES.map((c) => [c, entries.filter((e) => e.category === c).length])), technicalBlocked: unshippable(entries).length, technicalOutputsBlocked: unshippable(entries).filter((e) => e.category === "INFRA_OUTPUT" || (e.category === "COST_INPUT_OR_OUTPUT" && e.kind === "display")).length, productUiValidity: { valid: entries.filter((e) => !infrastructureSurface(e) && e.ui.status === "VALID").length, reviewRequired: invalidUi(entries).length }, model2RealityShippingReady: unshippable(entries).length === 0 }; }
export function newInventoryEntry(surface: Surface): ShippingEntry {
  return { ...surface, category: "UNREVIEWED", categoryReason: "Classification requires semantic review; new surfaces fail closed", ui: { status: "NOT_APPLICABLE", behavior: "Unreviewed", proofs: [] }, resources: ["ALL"], model1Meaning: "New visible surface requires explicit semantic review", model2Owner: "UNASSIGNED", changesState: false, effects: { physics: false, reachability: false, security: false, cost: false, evidence: false }, provenanceRequirements: ["Trace input to state owner and downstream proof; record units/domain for numeric values"], status: "UNKNOWN", finalProductEligible: false, plan: "Implement and prove the real mechanism or remove before Model-2 shipping" };
}
export function shippingInventory(root = shippingRoot) { return JSON.parse(readFileSync(resolve(root, "docs/reality/shipping-reality.json"), "utf8")) as { schema: string; entries: ShippingEntry[] }; }
if (import.meta.main) {
  const file = resolve(shippingRoot, "docs/reality/shipping-reality.json"), surfaces = visibleSurfaces(), previous = existsSync(file) ? shippingInventory().entries : [], byId = new Map(previous.map((e) => [e.id, e]));
  if (process.argv.includes("--write")) writeFileSync(file, JSON.stringify({ schema: "infraforge-shipping-reality/2", scope: "Separate PRODUCT_UI_VALIDITY from MODEL2_REALITY_SHIPPING_READY. New or changed fingerprints require review; ordinary current Model-1 validation checks inventory coverage only.", entries: surfaces.map((s) => byId.has(s.id) ? { ...byId.get(s.id)!, ...s } : newInventoryEntry(s)) }, null, 2) + "\n");
  const entries = shippingInventory().entries, errors = validateShipping(entries), blocked = unshippable(entries);
  if (errors.length) throw Error(errors.join("\n"));
  console.log(JSON.stringify({ ...shippingSummary(entries), ...(process.argv.includes("--blocked") ? { blocked } : {}) }));
  if (process.argv.includes("--ui-ready") && invalidUi(entries).length) { console.error("PRODUCT_UI_VALIDITY requires behavior proof review"); process.exitCode = 1; }
  if (process.argv.includes("--ready") && blocked.length) { console.error("MODEL2_REALITY_SHIPPING_READY refused: technical infrastructure surfaces remain incomplete"); process.exitCode = 1; }
}
