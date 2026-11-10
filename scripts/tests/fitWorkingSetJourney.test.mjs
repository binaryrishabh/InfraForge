import {expect, test} from "bun:test";
import {applyJourneyImprovement, journeyLab, selectJourney} from "../qa/learning-journey.mjs";

// Selector and retained edit proof; a fake page supplies no engine/browser execution result.
test("cache working set journey selects the cache capacity and refuses a dropped edit", async () => {
  const lab = journeyLab("fit-the-working-set"), edit = lab.improvement;
  expect(selectJourney({JOURNEY_LAB: lab.lessonId})).toEqual({kind: "lab", entry: lab});
  expect([edit.resourceId, edit.setting, edit.from, edit.to]).toEqual(["cache", "cachePolicy.capacityEntries", 16, 256]);
  expect(lab.hypothesis).toContain("Diagnosis:");
  const calls = []; let value = "16";
  const control = {first() {return this;}, async waitFor() {}, async fill(v) {calls.push(["fill", v]); value = v;}, async inputValue() {return value;}};
  const node = {filter() {return this;}, first() {return this;}, async click() {calls.push("open-cache");}};
  const page = {locator(selector) {expect(selector).toBe('[data-resource-id="cache"]'); return node;}, getByRole(role, {name}) {
    expect(role).toBe("spinbutton"); expect(name.test("Logical cache capacity")).toBe(true); expect(name.test("Cache TTL")).toBe(false); return control;
  }};
  expect(await applyJourneyImprovement(page, edit)).toEqual([{resourceId: "cache", setting: "cachePolicy.capacityEntries", value: "256"}]);
  expect(calls).toEqual(["open-cache", ["fill", "256"]]);
  control.inputValue = async () => "16";
  await expect(applyJourneyImprovement(page, edit)).rejects.toThrow("did not retain cache.cachePolicy.capacityEntries");
});
