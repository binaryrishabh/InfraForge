import {expect, test} from "bun:test";
import {applyJourneyImprovement, journeyLab, selectJourney} from "../qa/learning-journey.mjs";

// Selector and retained edit proof; a fake page supplies no engine/browser execution result.
test("replica freshness journey selects the modeled delay and refuses a dropped edit", async () => {
  const lab = journeyLab("bound-replica-staleness"), edit = lab.improvement;
  expect(selectJourney({JOURNEY_LAB: lab.lessonId})).toEqual({kind: "lab", entry: lab});
  expect([edit.resourceId, edit.setting, edit.from, edit.to]).toEqual(["db", "databaseReplication.replicationDelayMs", 1000, 10]);
  expect(lab.hypothesis).toContain("Diagnosis:");
  const calls = []; let value = "1000";
  const control = {first() {return this;}, async waitFor() {}, async fill(v) {calls.push(["fill", v]); value = v;}, async inputValue() {return value;}};
  const node = {filter() {return this;}, first() {return this;}, async click() {calls.push("open-db");}};
  const page = {locator(selector) {expect(selector).toBe('[data-resource-id="db"]'); return node;}, getByRole(role, {name}) {
    expect(role).toBe("spinbutton"); expect(name.test("Modeled replication delay")).toBe(true); expect(name.test("Replication source")).toBe(false); return control;
  }};
  expect(await applyJourneyImprovement(page, edit)).toEqual([{resourceId: "db", setting: "databaseReplication.replicationDelayMs", value: "10"}]);
  expect(calls).toEqual(["open-db", ["fill", "10"]]);
  control.inputValue = async () => "1000";
  await expect(applyJourneyImprovement(page, edit)).rejects.toThrow("did not retain db.databaseReplication.replicationDelayMs");
});
