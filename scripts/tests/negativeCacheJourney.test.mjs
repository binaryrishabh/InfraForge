import {expect,test} from "bun:test";
import {applyJourneyImprovement,journeyLab,selectJourney} from "../qa/learning-journey.mjs";
test("negative-cache journey edits its retained lifetime and refuses a dropped edit",async()=>{
 const lab=journeyLab("cache-an-empty-answer"),edit=lab.improvement;
 expect(selectJourney({JOURNEY_LAB:lab.lessonId})).toEqual({kind:"lab",entry:lab});
 expect([edit.resourceId,edit.setting,edit.from,edit.to]).toEqual(["cache","cachePolicy.negativeTtlSeconds",0,30]);
 expect(lab.hypothesis).toContain("Single-flight is already on");expect(lab.runWaitMs).toBeGreaterThanOrEqual(240000);
 const calls=[];let value="0";
 const control={first(){return this;},async waitFor(){},async fill(v){calls.push(["fill",v]);value=v;},async inputValue(){return value;}};
 const node={filter(){return this;},first(){return this;},async click(){calls.push("open-cache");}};
 const page={locator(s){expect(s).toBe('[data-resource-id="cache"]');return node;},getByRole(role,{name}){expect(role).toBe("spinbutton");expect(name.test("Negative cache TTL")).toBe(true);expect(name.test("Cache TTL")).toBe(false);return control;}};
 expect(await applyJourneyImprovement(page,edit)).toEqual([{resourceId:"cache",setting:"cachePolicy.negativeTtlSeconds",value:"30"}]);
 expect(calls).toEqual(["open-cache",["fill","30"]]);
 control.inputValue=async()=>"0";await expect(applyJourneyImprovement(page,edit)).rejects.toThrow("did not retain cache.cachePolicy.negativeTtlSeconds");
 expect(lab.reportRequirements.map((r,i)=>r.test(["Complete 19000 callers with at most 100 unsuccessful","At most 0.1 empty source queries per successful absent answer"][i]))).toEqual([true,true]);
});
