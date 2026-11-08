import type { LearningLesson } from "@infraforge/contracts/learning";

export const retryLimitsAndBudgetsV2: LearningLesson = {
  id: "retry-limits-and-budgets", contentVersion: 2, trackId: "depth", moduleId: "failure-controls",
  title: "Per-call limits and shared retry budgets", kind: "reading", level: "advanced", availability: "available",
  summary: "Distinguish attempts allowed for each call from retries allowed to overlap.",
  prerequisites: ["retries-add-work"], experiment: null,
  problem: ["Every call has a bounded attempt limit. Can many calls still retry together and consume the downstream budget?"],
  explanation: ["A maximum-attempt setting includes the first attempt and limits repetition for a particular call. It does not by itself limit how many different calls retry at the same time.",
    "The canvas load balancer also has a concurrent retry budget. Its policy reserves that budget for waiting backoffs as well as executing retries. Backoff changes timing; the attempt limit changes repetition; the shared budget bounds overlapping retry ownership.",
    "Reducing retry pressure can leave more original callers unsuccessful. Existing retry labs compare backend admissions and caller outcomes. Those totals do not identify which retries were suppressed by the shared budget."],
  check: {question: "Does a per-call attempt limit alone bound simultaneous retries across all calls?", choices: [
    {id: "yes", text: "Yes, because each call is bounded."}, {id: "no", text: "No, many bounded calls can retry together."}],
    correctChoiceId: "no", explanation: "Per-call repetition and shared overlapping work are separate populations."},
  limitations: ["Saved reports show Active retries (current attempts), Reserved backoffs (current calls) and Suppressed: retry budget (cumulative calls). Gauges describe the sampled instant; suppression counts cover this run segment. Missing historical fields stay Unknown. The existing admission-budget requirement scores amplification; suppression reasons are separate diagnostics.",
    "Retry counts establish neither safe repeated writes nor a provider availability guarantee."],
  followUp: "Choose the retry control that addresses overlapping work, and name its possible caller cost.",
};
