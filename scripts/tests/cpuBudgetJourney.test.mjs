import {expect, test} from "bun:test";
import {applyJourneyImprovement, journeyLab, selectJourney} from "../qa/learning-journey.mjs";

// This proves the journey edit and refusal, not an authenticated browser result.
test("CPU budget journey edits only application quota and refuses a lost edit", async () => {
  const lab = journeyLab("release-the-cpu-budget"), edit = lab.improvement;
  expect(selectJourney({JOURNEY_LAB: lab.lessonId})).toEqual({kind: "lab", entry: lab});
  expect([edit.resourceId, edit.setting, edit.from, edit.to]).toEqual(["app", "vmCpuQuota.limitPercent", 25, 100]);
  expect(lab.hypothesis).toContain("Diagnosis:");
  expect(lab.reportRequirements[0].test("Complete 1650; at most 20 unsuccessful through second 6")).toBe(true);
  const calls = []; let value = "25";
  const control = {first() {return this;}, async waitFor() {}, async fill(v) {calls.push(["fill", v]); value = v;}, async inputValue() {return value;}};
  const node = {filter() {return this;}, first() {return this;}, async click() {calls.push("open-app");}};
  const page = {locator(selector) {expect(selector).toBe('[data-resource-id="app"]'); return node;}, getByRole(role, {name}) {
    expect(role).toBe("spinbutton"); expect(name.test("Application CPU limit (%)")).toBe(true); expect(name.test("Active workers")).toBe(false); return control;
  }};
  expect(await applyJourneyImprovement(page, edit)).toEqual([{resourceId: "app", setting: "vmCpuQuota.limitPercent", value: "100"}]);
  expect(calls).toEqual(["open-app", ["fill", "100"]]);
  control.inputValue = async () => "25";
  await expect(applyJourneyImprovement(page, edit)).rejects.toThrow("did not retain app.vmCpuQuota.limitPercent");
});
