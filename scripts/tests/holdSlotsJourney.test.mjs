import {expect, test} from "bun:test";
import {applyJourneyImprovement, journeyLab, selectJourney} from "../qa/learning-journey.mjs";

// Selector and retained edit proof; a fake page supplies no engine/browser execution result.
test("held-capacity journey selects the worker's Jobs in parallel and refuses a dropped edit", async () => {
  const lab = journeyLab("hold-slots-on-a-slow-call"), edit = lab.improvement;
  expect(selectJourney({JOURNEY_LAB: lab.lessonId})).toEqual({kind: "lab", entry: lab});
  expect([edit.resourceId, edit.setting, edit.from, edit.to]).toEqual(["worker", "asyncWorker.concurrency", 1, 4]);
  expect(lab.hypothesis).toContain("Diagnosis:");
  const calls = []; let value = "1";
  const control = {first() {return this;}, async waitFor() {}, async fill(v) {calls.push(["fill", v]); value = v;}, async inputValue() {return value;}};
  const node = {filter() {return this;}, first() {return this;}, async click() {calls.push("open-worker");}};
  const page = {locator(selector) {expect(selector).toBe('[data-resource-id="worker"]'); return node;}, getByRole(role, {name}) {
    expect(role).toBe("spinbutton"); expect(name.test("Jobs in parallel")).toBe(true); expect(name.test("Prefetch credit (leased jobs)")).toBe(false); return control;
  }};
  expect(await applyJourneyImprovement(page, edit)).toEqual([{resourceId: "worker", setting: "asyncWorker.concurrency", value: "4"}]);
  expect(calls).toEqual(["open-worker", ["fill", "4"]]);
  control.inputValue = async () => "1";
  await expect(applyJourneyImprovement(page, edit)).rejects.toThrow("did not retain worker.asyncWorker.concurrency");
});
