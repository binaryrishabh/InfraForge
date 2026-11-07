import { finiteIoFixture, ioInvocation } from "./finiteIoFixture";
import { createStackComposition } from "../src/model2/composition/run";
import { EventKernel } from "../src/model2/time";
import { finiteIoRuntime } from "../src/model2/data/io";
import { relationalDatabase } from "../src/model2/data/database";

// Internal finite IO is not a canvas control. This is an accounting proof, not a lab.
export function finiteDurationSources() {
  const f = finiteIoFixture();
  const run = createStackComposition(f.input, {...f.composition, storage: f.profile});
  const samples = [600, 2000, run.horizon].map(at => { run.advanceTo(at); return run.evidence(); });
  const clock = new EventKernel(1000), io = finiteIoRuntime(f.profile, clock);
  const db = relationalDatabase(f.config, clock, undefined, undefined, io.forRole("db"));
  db.openSession("cancelled"); const receipt = db.accept(ioInvocation("cancelled", "heavy"), () => {});
  clock.advanceTo(2); receipt.cancel(); clock.advanceTo(1000);
  const cancelled = {capture: {throughUs: clock.now}, resources: [db.measure()], computeConfiguration: [],
    dataConfiguration: [f.config], data: {databases: [db.evidence()]}, network: {paths: []}};
  const g = finiteIoFixture();
  g.config.activeTransactions = g.q.q("direct.active", 2, "count");
  g.config.plans.heavy!.statements[0]!.blockingWait = g.q.q("direct.block", 20, "us");
  const directClock = new EventKernel(1000), directIo = finiteIoRuntime(g.profile, directClock);
  const directDb = relationalDatabase(g.config, directClock, undefined, undefined, directIo.forRole("db"));
  for (const id of ["a", "b", "c"]) { directDb.openSession(id); directDb.accept(ioInvocation(id, "heavy"), () => {}); }
  const directSamples = [2, 50, 120, 200, 1000].map(at => {
    directClock.advanceTo(at);
    return {capture: {throughUs: directClock.now}, resources: [directDb.measure()], computeConfiguration: [],
      dataConfiguration: [g.config], data: {databases: [directDb.evidence()]}, network: {paths: []}};
  });
  return {samples, cancelled, directSamples};
}
if (import.meta.main) console.log(JSON.stringify(finiteDurationSources()));
