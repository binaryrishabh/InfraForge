import {expect, test} from "bun:test";
import {applyJourneyImprovement, journeyLab, selectJourney} from "../qa/learning-journey.mjs";

// Selector/retention proof only; this fake page supplies no simulation evidence.
test("redundancy journey uses the real labelled policy select and refuses an unretained choice", async () => {
  const lab=journeyLab("restore-safe-redundancy"), edit=lab.improvement;
  expect(selectJourney({JOURNEY_LAB:lab.lessonId})).toEqual({kind:"lab",entry:lab});
  expect([edit.resourceId,edit.setting,edit.from,edit.to]).toEqual(["db","databaseReplication.rejoin",null,"snapshot-replay/1"]);
  const calls=[];let selected="off";
  const control={first(){return this;},async waitFor(){},async selectOption(v){calls.push(["select",v]);selected=v;},async inputValue(){return selected;}};
  const node={filter(){return this;},first(){return this;},async click(){calls.push("open-db");}};
  const page={locator(selector){expect(selector).toBe('[data-resource-id="db"]');return node;},getByRole(role,{name}){expect(role).toBe("combobox");expect(name.test("Old-primary catch-up")).toBe(true);expect(name.test("Read policy")).toBe(false);return control;}};
  expect(await applyJourneyImprovement(page,edit)).toEqual([{resourceId:"db",setting:"databaseReplication.rejoin",value:"snapshot-replay/1"}]);
  expect(calls).toEqual(["open-db",["select","snapshot-replay/1"]]);
  control.inputValue=async()=>"off";
  await expect(applyJourneyImprovement(page,edit)).rejects.toThrow("did not retain db.databaseReplication.rejoin");
});
