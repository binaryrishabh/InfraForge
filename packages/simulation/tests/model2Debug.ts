import { createModel2 } from "../src/model2/run";
import { proofInput } from "./model2Fixture";

const model = createModel2(proofInput()); model.advanceTo(model.horizon);
const evidence = model.evidence();
const inspect = new Set([0, 150000, 200000, 400000, 500000, 550000, model.horizon]);
console.info(JSON.stringify(process.argv.includes("--json") ? evidence : {
  status: evidence.status,
  modelVersion: evidence.modelVersion,
  scope: "Internal synthetic proof; not an active Free Mode or cloud prediction",
  intervention: evidence.faults,
  observations: evidence.samples.filter((s) => inspect.has(s.at)).map((s) => ({ atUs: s.at,
    completed: s.completed, failed: s.failed, inFlight: s.inFlight, resources: s.resources })),
  capture: evidence.capture,
  cost: evidence.cost,
  metricDefinitions: evidence.provenance.metrics,
}, null, 2));
