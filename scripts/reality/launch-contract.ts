import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const root = resolve(import.meta.dir, "../..");
// This inventory is independent of the claim entries. Include dormant legacy
// fields as well as controls currently visible in the first-stack inspector.
export const surfaces: Array<[string, string[]]> = [
  ["packages/domain/src/resource/Resource.interface.ts", ["Resource"]],
  ["packages/domain/src/resource/AutoscalingPolicy.interface.ts", ["AutoscalingPolicy"]],
  ["packages/domain/src/resource/ConnectionLine.interface.ts", ["ConnectionLine"]],
  ["packages/domain/src/workload/WorkloadProfile.interface.ts", ["WorkloadProfile"]],
  ["packages/contracts/src/actions/index.ts", ["ActionRequest", "ActionOutcome", "RunAction"]],
  ["packages/contracts/src/telemetry/SimulationSnapshot.interface.ts", ["SimulationSnapshot"]],
  ["packages/contracts/src/telemetry/ResourceMetrics.interface.ts", ["ResourceMetrics"]],
  ["packages/contracts/src/telemetry/PoolSnapshot.interface.ts", ["PoolSnapshot"]],
  ["packages/contracts/src/reports/report.ts", []],
  ["packages/contracts/src/reports/runRecord.ts", ["RunRecord"]],
  ["packages/contracts/src/run-inputs/RunInputs.interface.ts", []],
  ["packages/contracts/src/internal-model2/index.ts", ["ConnectedAdmissionRequest", "InternalReport"]],
  ["packages/simulation/src/model2/product/contracts.ts", ["SavedProductDesign", "ApplicationProfile", "NodeContract", "TransportProfile", "EdgeContract", "ProductContract", "ProductFault"]],
  ["packages/simulation/src/model2/workload/contracts.ts", ["OperationClass", "ArrivalTrace", "TraceRow", "WorkStation", "WorkloadInput"]],
  ["packages/simulation/src/model2/workload/profiles.ts", ["DemandProfile", "ProfileContext"]],
  ["packages/simulation/src/model2/compute/contracts.ts", ["ComputeProfile", "ComputeResource", "ComputeState"]],
  ["packages/simulation/src/model2/network/contracts.ts", ["LinkConfig", "PoolConfig", "PathConfig", "RetryPolicy", "LoadBalancer"]],
  ["packages/simulation/src/model2/data/contracts.ts", ["Row", "Statement", "TransactionPlan", "RelationalConfig", "CacheConfig", "AsideConfig"]],
  ["packages/simulation/src/model2/systems/contracts.ts", ["Listener", "DialConfig"]],
  ["packages/simulation/src/reality/provider/contracts.ts", ["Usage", "Estimate"]],
];
export interface SurfaceField { key: string; file: string; line: number }
export function exposedFields(read = (file: string) => readFileSync(resolve(root, file), "utf8")): SurfaceField[] {
  const found = new Map<string, SurfaceField>();
  for (const [file, names] of surfaces) {
    const tree = ts.createSourceFile(file, read(file).replaceAll("\r\n", "\n"), ts.ScriptTarget.Latest, true);
    const add = (node: ts.Node, prefix: string) => {
      if (ts.isPropertySignature(node) && node.name) {
        const key = `${prefix}.${node.name.getText(tree).replaceAll('"', "")}`;
        found.set(key, { key, file, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1 });
        if (node.type) ts.forEachChild(node.type, child => add(child, key));
      } else ts.forEachChild(node, child => add(child, prefix));
    };
    for (const node of tree.statements) if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      (!names.length || names.includes(node.name.text))) add(node, node.name.text);
    for (const name of names) if (!tree.statements.some(n => (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) && n.name.text === name)) throw Error(`Missing launch surface ${file}:${name}`);
  }
  // The saved-layout API accepts catchall JSON, so also inspect its actual
  // declared validation shape. A server-only setting must not escape coverage.
  const file = "apps/backend/zod_schemas/layout.schema.ts";
  const tree = ts.createSourceFile(file, read(file).replaceAll("\r\n", "\n"), ts.ScriptTarget.Latest, true);
  const objectShape = (node: ts.Node): ts.ObjectLiteralExpression | undefined => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "z.object" && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) return node.arguments[0];
    return ts.forEachChild(node, objectShape);
  };
  const addShape = (object: ts.ObjectLiteralExpression, prefix: string) => {
    for (const member of object.properties) if (ts.isPropertyAssignment(member)) {
      const key = `${prefix}.${member.name.getText(tree)}`;
      if (!found.has(key)) found.set(key, { key, file, line: tree.getLineAndCharacterOfPosition(member.getStart(tree)).line + 1 });
      const nested = objectShape(member.initializer);
      if (nested) addShape(nested, key === "Resource.autoscaling" ? "AutoscalingPolicy" : key);
    }
  };
  const schemas: Record<string, string> = { ResourceSchema: "Resource", ConnectionSchema: "ConnectionLine", LayoutSchema: "SavedLayout" };
  for (const statement of tree.statements) if (ts.isVariableStatement(statement)) for (const node of statement.declarationList.declarations) {
    const prefix = schemas[node.name.getText(tree)], shape = node.initializer && objectShape(node.initializer);
    if (prefix && shape) addShape(shape, prefix);
  }
  // Presentation keys and connected JSON projections are runtime-built rather
  // than declared interfaces. Inventory their actual AST output keys as well.
  for (const file of ["packages/simulation/src/model2/product/presentation.ts", "apps/backend/internalModel2/connectedPresentation.ts", "apps/backend/internalModel2/captureV2.ts"]) {
    const tree = ts.createSourceFile(file, read(file).replaceAll("\r\n", "\n"), ts.ScriptTarget.Latest, true);
    const put = (key: string, node: ts.Node) => found.set(key, { key, file, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1 });
    const metric = (node: ts.Node) => {
      let keys: string[] = [];
      if (ts.isStringLiteral(node)) keys = [node.text];
      if (ts.isTemplateExpression(node)) {
        keys = [node.head.text];
        for (const span of node.templateSpans) {
          let values = ["*"];
          if (span.expression.getText(tree) === "key") for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
            if (ts.isForOfStatement(parent) && ts.isVariableDeclarationList(parent.initializer) && parent.initializer.declarations[0]?.name.getText(tree) === "key") {
              const expression = ts.isAsExpression(parent.expression) ? parent.expression.expression : parent.expression;
              if (ts.isArrayLiteralExpression(expression)) values = expression.elements.filter(ts.isStringLiteral).map(e => e.text);
              break;
            }
          }
          keys = keys.flatMap(key => values.map(value => key + value + span.literal.text));
        }
      }
      for (const key of keys) put(`Model2Metric.${key}`, node);
    };
    const projection = (node: ts.Node, prefix: string) => {
      if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
        const key = `${prefix}.${node.name.getText(tree).replaceAll('"', "")}`;
        put(key, node);
        if (ts.isPropertyAssignment(node)) ts.forEachChild(node.initializer, child => projection(child, key));
      } else ts.forEachChild(node, child => projection(child, prefix));
    };
    const visit = (node: ts.Node) => {
      if (file.endsWith("captureV2.ts")) { projection(node, "ConnectedOutput"); return; }
      if (ts.isElementAccessExpression(node) && ["values", "p.values"].includes(node.expression.getText(tree))) metric(node.argumentExpression);
      if (file.endsWith("connectedPresentation.ts") && ts.isCallExpression(node) && node.expression.getText(tree) === "observed" && node.arguments[0]) metric(node.arguments[0]);
      if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "values" && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        for (const property of node.initializer.properties) if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name)) metric(property.name);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}
export type EvidenceLabel = "supported-calibrated" | "supported-logical" | "assumption-only" | "unsupported";
export interface Claim {
  id: string; fields: string[]; mechanism: string; model1: EvidenceLabel; model2: EvidenceLabel;
  scope: string; sources: Array<{ file: string; anchor: string }>;
}
export interface LaunchManifest { schema: "infraforge-launch-claims/1"; stack: string[]; claims: Claim[] }
export function readManifest(): LaunchManifest { return JSON.parse(readFileSync(resolve(root, "docs/reality/launch-claims.json"), "utf8")); }
export function validateLaunchClaims(manifest: LaunchManifest, fields = exposedFields()): string[] {
  const errors: string[] = [], covered = new Set<string>(), expected = new Set(fields.map(f => f.key)), ids = new Set<string>();
  if (manifest.schema !== "infraforge-launch-claims/1") errors.push("Unknown launch manifest version");
  const labels = ["supported-calibrated", "supported-logical", "assumption-only", "unsupported"];
  for (const claim of manifest.claims) {
    if (ids.has(claim.id)) errors.push(`Duplicate claim ${claim.id}`); ids.add(claim.id);
    if (!claim.fields.length || !claim.mechanism.trim() || !claim.scope.trim() || !claim.sources.length || !labels.includes(claim.model1) || !labels.includes(claim.model2)) errors.push(`Incomplete claim ${claim.id}`);
    for (const field of claim.fields) { if (covered.has(field)) errors.push(`Duplicate field ${field}`); if (!expected.has(field)) errors.push(`Stale field ${field}`); covered.add(field); }
    for (const source of claim.sources) if (!readFileSync(resolve(root, source.file), "utf8").replaceAll("\r\n", "\n").includes(source.anchor)) errors.push(`Missing source ${source.file}:${source.anchor}`);
  }
  for (const field of expected) if (!covered.has(field)) errors.push(`Exposed field has no claim: ${field}`);
  return errors;
}
export function matrixText(manifest = readManifest()) {
  const fields = new Map(exposedFields().map(f => [f.key, f]));
  const ref = (file: string, anchor: string) => `${file}:${readFileSync(resolve(root, file), "utf8").replaceAll("\r\n", "\n").split("\n").findIndex(line => line.includes(anchor)) + 1}`;
  const header = [
    "# First-stack launch claim matrix", "",
    "Generated by `bun --no-env-file scripts/reality/launch-contract.ts --write` from launch-claims.json.", "",
    "Scope: load balancer, application compute, PostgreSQL-oriented keyed relational operations, optional keyed cache. Model 1 remains ACTIVE; Model 2 remains INTERNAL. No universal prediction or public reality-ready claim is authorized. Optional cache has logical module support but is excluded from the current connected admission profile.", "",
    "Labels describe current evidence, not the desired launch promise. supported-logical proves software semantics within the stated scope; assumption-only means an authored/historical numerical model; unsupported means unavailable or no mechanism for that claim. supported-calibrated requires disjoint measured validation for the exact advertised domain; no whole-stack metric currently earns it. Unknown is never zero.", "",
    "Every declared field below has an explicit entry, including nested controls and output metadata. Arbitrary saved catchall JSON is unsupported; it does not acquire physics by being saved. Adding fields to inventoried contracts fails the coverage test until reviewed. Display names/layout/identity are logical metadata, not capacity inputs.", "",
    "| Fields (declaration) | Mechanism / output | Model 1 | Model 2 | Scope and evidence |",
    "| --- | --- | --- | --- | --- |",
  ];
  const code = (text: string) => "`" + text + "`";
  return [...header, ...manifest.claims.map(c => {
    const declarations = c.fields.map(key => { const f = fields.get(key)!; return code(key) + " (" + code(`${f.file}:${f.line}`) + ")"; }).join("<br>");
    return `| ${declarations} | ${c.mechanism} | ${c.model1} | ${c.model2} | ${c.scope} Sources: ${c.sources.map(s => code(ref(s.file, s.anchor))).join(", ")} |`;
  })].join("\n") + "\n";
}
if (import.meta.main) {
  const manifest = readManifest(), errors = validateLaunchClaims(manifest);
  if (errors.length) throw Error(errors.join("\n"));
  const file = resolve(root, "docs/reality/launch-claim-matrix.md"), text = matrixText(manifest);
  if (process.argv.includes("--write")) writeFileSync(file, text);
  else if (readFileSync(file, "utf8").replaceAll("\r\n", "\n") !== text) throw Error("Launch matrix drift");
  console.info(JSON.stringify({ claims: manifest.claims.length, exposedFields: exposedFields().length }));
}
