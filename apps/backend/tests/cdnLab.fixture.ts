import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";
import { buildRunReport } from "../reports/report";
import { findLearningLesson } from "../learning/registry";

export function cdnLabFixture() {
  const d = definition("keep-an-asset-cached"), near = structuredClone(d.starter!);
  near.resources.find(r => r.id === "cdn")!.cdnCachePolicy!.ttlSeconds = 10;
  const rows = [d.starter!, REFERENCE[d.id]!, near].map(s => attemptRow(d, s, answers(d, {"overall-health": "degraded"})));
  return {lesson: findLearningLesson(d.id)!, rows, reports: rows.map(r => buildRunReport(r))};
}
if (import.meta.main) console.log(JSON.stringify(cdnLabFixture()));
