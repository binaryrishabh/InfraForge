import {expect, test} from "bun:test";
import {applyJourneyImprovement, journeyLab, selectJourney} from "../qa/learning-journey.mjs";

// Selector and retained edit proof; a fake page supplies no engine/browser execution result.
test("edge admission journey selects the balancer's Active requests and refuses a dropped edit", async () => {
  const lab = journeyLab("shed-load-at-the-edge"), edit = lab.improvement;
  expect(selectJourney({JOURNEY_LAB: lab.lessonId})).toEqual({kind: "lab", entry: lab});
  expect([edit.resourceId, edit.setting, edit.from, edit.to]).toEqual(["lb", "lbAdmission.maxActive", 1024, 16]);
  expect(lab.hypothesis).toContain("Diagnosis:");
  const calls = []; let value = "1024";
  const control = {first() {return this;}, async waitFor() {}, async fill(v) {calls.push(["fill", v]); value = v;}, async inputValue() {return value;}};
  const node = {filter() {return this;}, first() {return this;}, async click() {calls.push("open-lb");}};
  const page = {locator(selector) {expect(selector).toBe('[data-resource-id="lb"]'); return node;}, getByRole(role, {name}) {
    expect(role).toBe("spinbutton"); expect(name.test("Active requests")).toBe(true); expect(name.test("Queued requests")).toBe(false); return control;
  }};
  expect(await applyJourneyImprovement(page, edit)).toEqual([{resourceId: "lb", setting: "lbAdmission.maxActive", value: "16"}]);
  expect(calls).toEqual(["open-lb", ["fill", "16"]]);
  control.inputValue = async () => "1024";
  await expect(applyJourneyImprovement(page, edit)).rejects.toThrow("did not retain lb.lbAdmission.maxActive");
});
