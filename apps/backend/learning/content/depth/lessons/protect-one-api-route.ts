import type { LearningLesson } from "@infraforge/contracts/learning";

export const protectOneApiRoute: LearningLesson = {
  id: "protect-one-api-route", contentVersion: 1, trackId: "depth", moduleId: "resource-pressure",
  title: "Protect one API route", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Protect a bounded read backend while keeping a second route's independent admission budget useful.",
  prerequisites: ["route-around-a-slow-vm"],
  problem: ["The gateway receives 1000 reads and 1000 writes each second. Read has 10000 initial burst credits, refills at one per second and targets a one-worker backend with no waiting queue. Write has its own 100-credit bucket, refilling at 100/s.",
    "By second 2, complete two reads and 250 writes without upstream failures on either route. These educational requirements allow deliberate rate refusals; count those callers too."],
  explanation: ["Predict terminal health, then run unchanged. Inspect read-route completions and upstream failures alongside the backend's CPU. Separate gateway rate refusals from admitted calls that fail upstream.",
    "Change only read burst credits from 10000 to one, retaining its one-per-second refill. Run again and compare both routes' admitted and completed counts. Explain why changing the write route's bucket would miss the read bottleneck.",
    "Compare whole-run failed callers as well as successful work. State the cost of protection. Independent route tokens do not reserve shared gateway CPU, transport or in-flight capacity, so this run cannot prove universal freedom from starvation."],
  experiment: {challengeId: "protect-one-api-route", prediction: "Can read-route burst admission fall while write-route completions stay unchanged, even if overall health remains unhealthy?",
    evidenceToInspect: ["Saved per-route admitted, rate-refused, completed and upstream-failed populations through second 2", "Read backend CPU and health at second 2", "Whole-run completed, failed and in-flight callers plus shared-capacity refusals"]},
  limitations: ["This model uses exact GET /read and POST /write routes with independent token buckets. There is no selectable single shared route bucket; the global in-flight bound is a different mechanism.",
    "Routes share command CPU, transport and in-flight capacity. Unchanged write counts in these controlled runs do not prove fairness for every workload or a general starvation guarantee.",
    "Protection refuses more offered work. Passing requirements do not establish availability, authentication, provider quotas, real prices or a whole-run latency SLO."],
  followUp: "Use the saved counts to explain both backend protection and the extra caller refusals. Name one shared bottleneck that independent route tokens cannot remove.", check: null,
};
