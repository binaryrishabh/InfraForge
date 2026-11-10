import {expect, test} from "bun:test";
import {applyJourneyImprovement, journeyLab, selectJourney} from "../qa/learning-journey.mjs";

// Selector and retained edit proof; a fake page supplies no engine/browser execution result.
test("artifact journey selects the VM's single byte field and refuses a dropped edit", async () => {
  const lab = journeyLab("admit-a-replica-image"), edit = lab.improvement;
  expect(selectJourney({JOURNEY_LAB: lab.lessonId})).toEqual({kind: "lab", entry: lab});
  expect([edit.resourceId, edit.setting, edit.from, edit.to]).toEqual(["app", "artifactCachePolicy.capacityBytes", 256, 4096]);
  expect(lab.hypothesis).toContain("Diagnosis:"); expect(lab.hypothesis).toContain("node-blob-cache-capacity");
  const calls = []; let value = "256";
  const control = {first() {return this;}, async waitFor() {}, async fill(v) {calls.push(["fill", v]); value = v;}, async inputValue() {return value;}};
  const node = {filter() {return this;}, first() {return this;}, async click() {calls.push("open-app");}};
  const page = {locator(selector) {expect(selector).toBe('[data-resource-id="app"]'); return node;}, getByRole(role, {name}) {
    expect(role).toBe("spinbutton"); expect(name.test("Artifact cache capacity (bytes)")).toBe(true); expect(name.test("Target CPU")).toBe(false); return control;
  }};
  expect(await applyJourneyImprovement(page, edit)).toEqual([{resourceId: "app", setting: "artifactCachePolicy.capacityBytes", value: "4096"}]);
  expect(calls).toEqual(["open-app", ["fill", "4096"]]);
  control.inputValue = async () => "256";
  await expect(applyJourneyImprovement(page, edit)).rejects.toThrow("did not retain app.artifactCachePolicy.capacityBytes");
});
