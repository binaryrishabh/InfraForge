import { buildRunReport } from "../reports/report";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

// Child process for web rendering tests: real backend reports for the lab's starter and one-change reference.
if (import.meta.main) {
  const d = definition("scale-on-delivered-samples"), prediction = answers(d, { scale: "yes" });
  console.log(JSON.stringify({ starter: buildRunReport(attemptRow(d, d.starter!, prediction)), reference: buildRunReport(attemptRow(d, REFERENCE[d.id]!, prediction)) }));
}
