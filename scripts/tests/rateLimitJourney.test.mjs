import {expect, test} from "bun:test";
import {applyJourneyImprovement, journeyLab, selectJourney} from "../qa/learning-journey.mjs";

// Selector and retained edit proof; a fake page supplies no engine/browser execution result.
test("rate limit journey selects the sustained rate and refuses a dropped edit", async () => {
  const lab = journeyLab("set-the-limit-above-the-peak"), edit = lab.improvement;
  expect(selectJourney({JOURNEY_LAB: lab.lessonId})).toEqual({kind: "lab", entry: lab});
  expect([edit.resourceId, edit.setting, edit.from, edit.to]).toEqual(["lb", "lbRateLimit.sustainedRequestsPerSecond", 300, 800]);
  expect(lab.hypothesis).toContain("Diagnosis:");
  const calls = []; let value = "300";
  const control = {first() {return this;}, async waitFor() {}, async fill(v) {calls.push(["fill", v]); value = v;}, async inputValue() {return value;}};
  const node = {filter() {return this;}, first() {return this;}, async click() {calls.push("open-lb");}};
  const page = {locator(selector) {expect(selector).toBe('[data-resource-id="lb"]'); return node;}, getByRole(role, {name}) {
    expect(role).toBe("spinbutton"); expect(name.test("Sustained requests per second")).toBe(true); expect(name.test("Burst requests")).toBe(false); return control;
  }};
  expect(await applyJourneyImprovement(page, edit)).toEqual([{resourceId: "lb", setting: "lbRateLimit.sustainedRequestsPerSecond", value: "800"}]);
  expect(calls).toEqual(["open-lb", ["fill", "800"]]);
  control.inputValue = async () => "300";
  await expect(applyJourneyImprovement(page, edit)).rejects.toThrow("did not retain lb.lbRateLimit.sustainedRequestsPerSecond");
});
