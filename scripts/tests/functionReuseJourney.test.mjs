import {expect, test} from "bun:test";
import {applyJourneyImprovement, journeyLab, selectJourney} from "../qa/learning-journey.mjs";

// Selector and retained edit proof; a fake page supplies no engine/browser execution result.
test("function retention journey selects the single idle expiry field and refuses a dropped edit", async () => {
  const lab = journeyLab("keep-a-function-warm"), edit = lab.improvement;
  expect(selectJourney({JOURNEY_LAB: lab.lessonId})).toEqual({kind: "lab", entry: lab});
  expect([edit.resourceId, edit.setting, edit.from, edit.to]).toEqual(["fn", "serverless.idleExpiryMs", 100, 5000]);
  expect(lab.hypothesis).toContain("Diagnosis:"); expect(lab.hypothesis).toContain("idle instances expire");
  const calls = []; let value = "100";
  const control = {first() {return this;}, async waitFor() {}, async fill(v) {calls.push(["fill", v]); value = v;}, async inputValue() {return value;}};
  const node = {filter() {return this;}, first() {return this;}, async click() {calls.push("open-fn");}};
  const page = {locator(selector) {expect(selector).toBe('[data-resource-id="fn"]'); return node;}, getByRole(role, {name}) {
    expect(role).toBe("spinbutton"); expect(name.test("Warm instance idle expiry (ms)")).toBe(true); expect(name.test("Concurrent invocations")).toBe(false); return control;
  }};
  expect(await applyJourneyImprovement(page, edit)).toEqual([{resourceId: "fn", setting: "serverless.idleExpiryMs", value: "5000"}]);
  expect(calls).toEqual(["open-fn", ["fill", "5000"]]);
  control.inputValue = async () => "100";
  await expect(applyJourneyImprovement(page, edit)).rejects.toThrow("did not retain fn.serverless.idleExpiryMs");
});
