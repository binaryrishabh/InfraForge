import { readFileSync, writeFileSync } from "node:fs";
import { candidateProfiles, measuredInput } from "./workload-calibration";
import { quantities } from "../../packages/simulation/tests/workloadFixture";
import { createWorkloadModel2 } from "../../packages/simulation/src/model2/workload/run";

export function workloadProofs() {
  const measurement = JSON.parse(readFileSync(new URL("../../docs/reality/m2b-measurements.json", import.meta.url), "utf8"));
  const traces = JSON.parse(readFileSync(new URL("../../docs/reality/m2b-heldout-traces.json", import.meta.url), "utf8"));
  return ["overload", "pause-detach", "pause-cancel"].map((name) => {
    const trace = traces.find((t: { name: string; factor: number }) => t.name === "heavy" && t.factor === 1);
    const input = measuredInput(measurement, trace.trace, 4000000, 100000), numbers = quantities("Authored internal M2B intervention/queue/deadline experiment using host-specific candidate demand; no external fault validation");
    input.operations.forEach((o) => { o.callerTimeout = numbers.q(`${name}.${o.id}.timeout`, 100000, "us"); o.onCallerStop = name === "pause-cancel" ? "request-cancellation" : "detach"; });
    const service = input.resources[0]!;
    if (service.kind === "router") throw new Error();
    service.queueCapacity = numbers.q(`${name}.queue`, 16, "count"); service.cancellation = name === "pause-cancel" ? "cooperative" : "unsupported";
    if (name !== "overload") input.faults = [{ id: "pause", target: "service", kind: "pause-service", at: numbers.q(`${name}.fault.at`, 200000, "us"), duration: numbers.q(`${name}.fault.duration`, 400000, "us") }];
    input.ledger.push(...numbers.ledger);
    const model = createWorkloadModel2(input); model.advanceTo(model.horizon); const e = model.evidence();
    return { name, status: "internal mechanism proof; measured demand plus authored queue/deadline/fault assumptions", counts: e.counts, resources: e.resources,
      at500000Us: e.samples.find((s) => s.at === 500000), at700000Us: e.samples.find((s) => s.at === 700000), execution: e.execution,
      profiles: candidateProfiles(measurement).fits.map((f) => f.profile.id), resultRetention: e.resultRetention };
  });
}
if (import.meta.main) {
  const proof = workloadProofs();
  if (process.argv.includes("--write")) writeFileSync(new URL("../../docs/reality/m2b-proofs.json", import.meta.url), JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify(proof, null, process.argv.includes("--json") ? 2 : 0));
}
