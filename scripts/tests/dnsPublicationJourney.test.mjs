import {expect, test} from "bun:test";
import {applyJourneyImprovement, journeyLab, selectJourney} from "../qa/learning-journey.mjs";

// Selector/retention proof only; this fake page supplies no simulation evidence.
test("DNS publication journey uses the real labelled TTL control and refuses an unretained choice", async () => {
  const lab=journeyLab("resolve-after-publication"), edit=lab.improvement;
  expect(selectJourney({JOURNEY_LAB:lab.lessonId})).toEqual({kind:"lab",entry:lab});
  expect([edit.resourceId,edit.setting,edit.from,edit.to]).toEqual(["dns","dnsCachePolicy.maxTtlSeconds",60,1]);
  const calls=[];let selected="60";
  const control={first(){return this;},async waitFor(){},async fill(v){calls.push(["fill",v]);selected=v;},async inputValue(){return selected;}};
  const node={filter(){return this;},first(){return this;},async click(){calls.push("open-dns");}};
  const page={locator(selector){expect(selector).toBe('[data-resource-id="dns"]');return node;},getByRole(role,{name}){expect(role).toBe("spinbutton");expect(name.test("Maximum cached TTL (seconds)")).toBe(true);expect(name.test("Read policy")).toBe(false);return control;}};
  expect(await applyJourneyImprovement(page,edit)).toEqual([{resourceId:"dns",setting:"dnsCachePolicy.maxTtlSeconds",value:"1"}]);
  expect(calls).toEqual(["open-dns",["fill","1"]]);
  control.inputValue=async()=>"60";
  await expect(applyJourneyImprovement(page,edit)).rejects.toThrow("did not retain dns.dnsCachePolicy.maxTtlSeconds");
});
