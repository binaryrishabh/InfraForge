import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exposedFields, matrixText, readManifest, root, validateLaunchClaims } from "../reality/launch-contract";
import { runRecordSchemaText } from "../reality/run-record-schema";

test("every declared first-stack setting and output has one sourced evidence claim", () => {
  expect(validateLaunchClaims(readManifest())).toEqual([]);
  expect(exposedFields().length).toBeGreaterThan(500);
});
test("new exposed settings fail until explicitly reviewed, including nested fields", () => {
  const fields = exposedFields(file => {
    const text = readFileSync(resolve(root, file), "utf8");
    return file.endsWith("Resource.interface.ts") ? text.replace("id: string;", "id: string; newControl?: { demand: number };") : text;
  });
  expect(validateLaunchClaims(readManifest(), fields)).toContain("Exposed field has no claim: Resource.newControl");
  expect(validateLaunchClaims(readManifest(), fields)).toContain("Exposed field has no claim: Resource.newControl.demand");
});
test("server-only saved settings cannot hide behind catchall JSON", () => {
  const fields = exposedFields(file => {
    const text = readFileSync(resolve(root, file), "utf8");
    return file.endsWith("layout.schema.ts") ? text.replace("skuId: z.string()", "serverOnly: z.number(), skuId: z.string()") : text;
  });
  expect(validateLaunchClaims(readManifest(), fields)).toContain("Exposed field has no claim: Resource.serverOnly");
});
test("new runtime-built metric and raw evidence outputs also require claims", () => {
  const fields = exposedFields(file => {
    let text = readFileSync(resolve(root, file), "utf8");
    if (file.endsWith("connectedPresentation.ts")) text = text.replace('["offered",', '["unreviewedMetric", "offered",');
    if (file.endsWith("captureV2.ts")) text = text.replace("input: e.fingerprint", "unreviewedOutput: true, input: e.fingerprint");
    return text;
  });
  expect(validateLaunchClaims(readManifest(), fields)).toContain("Exposed field has no claim: Model2Metric.caller.unreviewedMetric");
  expect(validateLaunchClaims(readManifest(), fields)).toContain("Exposed field has no claim: ConnectedOutput.unreviewedOutput");
});
test("missing, duplicate, stale and incomplete claims are rejected", () => {
  const missing = readManifest(); missing.claims[0]!.fields.pop();
  expect(validateLaunchClaims(missing).some(e => e.includes("no claim"))).toBe(true);
  const duplicate = readManifest(); duplicate.claims.push(duplicate.claims[0]!);
  expect(validateLaunchClaims(duplicate).some(e => e.includes("Duplicate"))).toBe(true);
  const stale = readManifest(); stale.claims[0]!.fields.push("Resource.invented");
  expect(validateLaunchClaims(stale)).toContain("Stale field Resource.invented");
  const empty = readManifest(); empty.claims[0]!.sources = [];
  expect(validateLaunchClaims(empty).some(e => e.includes("Incomplete"))).toBe(true);
});
test("matrix and RunRecord JSON schema match their generators after LF normalization", () => {
  expect(readFileSync(resolve(root, "docs/reality/launch-claim-matrix.md"), "utf8").replaceAll("\r\n", "\n")).toBe(matrixText());
  expect(readFileSync(resolve(root, "docs/reality/run-record.schema.json"), "utf8").replaceAll("\r\n", "\n")).toBe(runRecordSchemaText());
});
test("line endings cannot change claim coverage", () => {
  const read = (file: string) => readFileSync(resolve(root, file), "utf8").replaceAll("\r\n", "\n");
  expect(exposedFields(file => read(file).replaceAll("\n", "\r\n"))).toEqual(exposedFields(read));
});
