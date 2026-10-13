import { expect } from "bun:test";
import type { RerunOptions } from "@infraforge/contracts/reports";
import type { LocalHarness } from "./localHarness";
import { layout } from "./scenario";

export async function checkCanvasPreview(harness: LocalHarness, source: string, design: string, runs: string[]) {
  const canvas = structuredClone(layout);
  canvas.resources[2]!.skuId = "m5.2xlarge";
  canvas.resources[2]!.x += 24;
  const originalDesign = (await harness.sql.query('SELECT layout FROM "Infrastructure" WHERE id=$1', [design])).rows[0].layout;
  const originalInput = (await harness.sql.query('SELECT "runInputs" FROM "Deployment" WHERE id=$1', [source])).rows[0].runInputs;
  const preview: RerunOptions = (await harness.request(`/deployments/${source}/rerun-preview`, { layout: canvas }, "POST")).options;
  expect(preview.currentDesign.preview?.grade).toBe("one-change-design");
  expect((await harness.sql.query('SELECT layout FROM "Infrastructure" WHERE id=$1', [design])).rows[0].layout).toEqual(originalDesign);
  const request = { mode: "current-design", matchedStop: true, expectedInputHash: preview.currentDesign.inputHash };
  // Unsaved preview cannot accidentally deploy a different saved design.
  await harness.request(`/deployments/${source}/reruns`, request, "POST", 409);
  await harness.request(`/infrastructure/${design}`, { name: "Canvas improvement", layout: canvas }, "PUT");
  const run = (await harness.request(`/deployments/${source}/reruns`, request, "POST", 201)).createdDeployment;
  runs.push(run.id);
  expect(run.runInputs.resources).toEqual(canvas.resources);
  expect(run.runInputs.connectionLines).toEqual(canvas.connectionLines);
  expect(run.runInputs.seed).toBe(originalInput.seed);
  expect(run.runInputs.workloadProfile).toEqual(originalInput.workloadProfile);
  expect((await harness.sql.query('SELECT "runInputs" FROM "Deployment" WHERE id=$1', [source])).rows[0].runInputs).toEqual(originalInput);
  return run.id as string;
}
