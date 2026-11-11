import {expect, test} from "bun:test";
import {applyJourneyImprovement, journeyLab, selectJourney} from "../qa/learning-journey.mjs";

// Selector and retained edit proof; a fake page supplies no engine/browser execution result.
test("scaling stall journey selects the export interval and refuses a dropped edit", async () => {
  const lab = journeyLab("trace-a-scaling-stall"), edit = lab.improvement;
  expect(selectJourney({JOURNEY_LAB: lab.lessonId})).toEqual({kind: "lab", entry: lab});
  expect([edit.resourceId, edit.setting, edit.from, edit.to]).toEqual(["monitor", "monitoringPolicy.exportIntervalSeconds", 20, 2]);
  expect(lab.hypothesis).toContain("Diagnosis:");
  const calls = []; let value = "20";
  const control = {first() {return this;}, async waitFor() {}, async fill(v) {calls.push(["fill", v]); value = v;}, async inputValue() {return value;}};
  const node = {filter() {return this;}, first() {return this;}, async click() {calls.push("open-monitor");}};
  const page = {locator(selector) {expect(selector).toBe('[data-resource-id="monitor"]'); return node;}, getByRole(role, {name}) {
    expect(role).toBe("spinbutton"); expect(name.test("Export every (seconds)")).toBe(true); expect(name.test("Collect every (seconds)")).toBe(false); return control;
  }};
  expect(await applyJourneyImprovement(page, edit)).toEqual([{resourceId: "monitor", setting: "monitoringPolicy.exportIntervalSeconds", value: "2"}]);
  expect(calls).toEqual(["open-monitor", ["fill", "2"]]);
  control.inputValue = async () => "20";
  await expect(applyJourneyImprovement(page, edit)).rejects.toThrow("did not retain monitor.monitoringPolicy.exportIntervalSeconds");
});
