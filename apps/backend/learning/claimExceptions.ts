/** Exact, reviewed prose only. Never authorize an unscoped number or SKU. */
export interface ClaimException {
  lesson: string;
  field: string;
  text: string;
  values: string[];
  reason: string;
}
export const CLAIM_EXCEPTIONS: readonly ClaimException[] = [
  {
    "lesson": "where-does-the-time-go@1",
    "field": "explanation.0",
    "text": "The starter offers 350 reads each second. Each read asks for 3 ms of app CPU work and 1 ms of database CPU work in this educational profile.",
    "values": [
      "3"
    ],
    "reason": "The canvas profile authors 3000 cpu-us per app read (3 ms), outside the challenge fields. Source: packages/simulation/src/model2/product/fromDesign.ts application.demands; regression: apps/backend/tests/firstRunsCalibration.test.ts."
  },
  {
    "lesson": "where-does-the-time-go@1",
    "field": "explanation.2",
    "text": "In the app's Instance size section, select c5.large and run again. Compare CPU, completed requests/second and p95. Then try a larger database with the original generic app to test your explanation.",
    "values": [
      "c5.large"
    ],
    "reason": "c5.large is the one-change reference input, not a starter size or a promised outcome. Sources: apps/backend/tests/challengeHarness.ts and firstRunsCalibration.test.ts."
  },
  {
    "lesson": "waiting-with-spare-cpu@1",
    "field": "explanation.1",
    "text": "Select the app. Under VM execution, change Active workers from 1 to 4 while leaving Instance size Generic and Queued requests at 256. Run again under the same workload.",
    "values": [
      "4"
    ],
    "reason": "Four active workers is the controlled reference input, not the one-worker starter. Sources: apps/backend/tests/challengeHarness.ts and firstRunsCalibration.test.ts."
  },
  {
    "lesson": "waiting-with-spare-cpu@1",
    "field": "explanation.2",
    "text": "Restore one worker and select c5.xlarge under Instance size. Compare the result: extra CPU cannot admit another request through an unchanged single worker slot.",
    "values": [
      "c5.xlarge"
    ],
    "reason": "c5.xlarge is the tested CPU-only near miss with worker slots held fixed. Source: apps/backend/tests/firstRunsCalibration.test.ts."
  },
  {
    "lesson": "one-bigger-or-two-smaller@1",
    "field": "explanation.1",
    "text": "First change app from c5.large to c5.xlarge. Then restore c5.large and add a second c5.large, connecting lb to the new app and the new app to db.",
    "values": [
      "c5.xlarge"
    ],
    "reason": "c5.xlarge is the vertical reference, compared with the horizontal c5.large reference under unchanged traffic. Sources: apps/backend/tests/challengeHarness.ts and firstRunsCalibration.test.ts."
  },
  {
    "lesson": "leave-room-for-a-burst@1",
    "field": "problem.0",
    "text": "A small app handles the baseline 100 reads/second. Traffic rises to 400/second from second 120 until 140; the challenge stops at 125.",
    "values": [
      "120",
      "140"
    ],
    "reason": "The existing peak profile starts at second 120 for 20 seconds; 140 is its end. Sources: packages/simulation/src/tuning.ts BURST_CYCLE_SECONDS/BURST_DURATION_SECONDS and apps/backend/tests/scalingCalibration.test.ts."
  },
  {
    "lesson": "leave-room-for-a-burst@1",
    "field": "explanation.1",
    "text": "Select app and change Instance size from Generic to c5.large. Run again. Keep topology, workload and queue settings fixed.",
    "values": [
      "c5.large"
    ],
    "reason": "c5.large is a controlled reference input, absent from the Generic starter. Sources: apps/backend/tests/challengeHarness.ts and scalingCalibration.test.ts."
  },
  {
    "lesson": "leave-room-for-a-burst@1",
    "field": "explanation.2",
    "text": "Repeat with c5.xlarge. Both are valid capacity choices for this workload. Compare CPU at second 125 and the CostEstimate stage's educational monthly estimate; discuss the extra headroom you are paying for.",
    "values": [
      "c5.xlarge"
    ],
    "reason": "c5.xlarge is the separate larger reference input; estimates stay educational. Sources: apps/backend/tests/challengeHarness.ts and scalingCalibration.test.ts."
  },
  {
    "lesson": "leave-room-for-a-burst@1",
    "field": "followUp",
    "text": "Compare c5.large with c5.xlarge. Which leaves less CPU headroom, what does each estimate cost, and what demand is still untested?",
    "values": [
      "c5.large",
      "c5.xlarge"
    ],
    "reason": "The follow-up names the same two controlled reference inputs, not a measured headroom or price. Sources: apps/backend/tests/challengeHarness.ts and scalingCalibration.test.ts."
  },
  {
    "lesson": "budget-app-database-sessions@1",
    "field": "problem.0",
    "text": "Twelve app pools can collectively ask for more than the database's 85 sessions. A short CPU slowdown gives lazy pools time to open connections, which can remain idle afterward.",
    "values": [
      "85"
    ],
    "reason": "The captured db.t3.micro tier has an educational 85-session limit. Sources: packages/catalog/src/aws.catalog.ts and apps/backend/tests/dataLabsCalibration.test.ts."
  },
  {
    "lesson": "budget-app-database-sessions@1",
    "field": "explanation.1",
    "text": "Select lb. Under Autoscaling pool, change Minimum from 12 to 4, leaving Maximum at 12. Keep the database and workload unchanged and run again.",
    "values": [
      "4"
    ],
    "reason": "Four initial replicas is the one-change reference input. Sources: apps/backend/tests/challengeHarness.ts and dataLabsCalibration.test.ts."
  },
  {
    "lesson": "budget-app-database-sessions@1",
    "field": "explanation.2",
    "text": "Compare actual sessions with the possible pool budget: 12 times 10 versus 4 times 10. Try increasing only app Instance size to m5.2xlarge as a near miss. Examine whole-run latency bounds too; fewer refusals need not mean a shorter latency tail.",
    "values": [
      "10",
      "4",
      "m5.2xlarge"
    ],
    "reason": "Ten connections is the per-instance/path canvas pool assumption; four replicas is the reference and m5.2xlarge the tested CPU-only near miss. Sources: packages/simulation/src/model2/product/fromDesign.ts transports.database and apps/backend/tests/dataLabsCalibration.test.ts."
  },
  {
    "lesson": "budget-app-database-sessions@1",
    "field": "limitations.0",
    "text": "Results are educational model outputs. App-to-database pools are lazy, with a fixed maximum of 10 connections per instance/path and a 10-second idle timeout. Pool size is not a canvas control here.",
    "values": [
      "10"
    ],
    "reason": "Both ten-connection pool maximum and ten-second idle close are explicit educational defaults, not saved controls. Source: packages/simulation/src/model2/product/fromDesign.ts transports.database."
  },
  {
    "lesson": "budget-app-database-sessions@1",
    "field": "limitations.1",
    "text": "Minimum replicas controls initial instances in this Model 2 profile. This six-second run ends before the ten-second controller evaluation; it proves no long-run cap.",
    "values": [
      "10"
    ],
    "reason": "The canvas controller interval is 10000000 us (ten seconds), beyond the six-second stop. Source: packages/simulation/src/model2/product/fromDesign.ts controller.interval."
  },
  {
    "lesson": "budget-app-database-sessions@1",
    "field": "limitations.3",
    "text": "CPU slowdown and the 85-session tier limit are educational assumptions. No database outage, promotion or cache failure is applied.",
    "values": [
      "85"
    ],
    "reason": "The installed educational db.t3.micro catalog tier sets maxConnections to 85. Source: packages/catalog/src/aws.catalog.ts; regression: apps/backend/tests/dataLabsCalibration.test.ts."
  },
  {
    "lesson": "replicas-do-not-take-writes@1",
    "field": "explanation.2",
    "text": "Restore the starter, then select db.t3.micro under Instance size and run again. Compare p95, completions and failures with the starter and the replica-only attempt.",
    "values": [
      "db.t3.micro"
    ],
    "reason": "db.t3.micro is the tested writer-tier reference input. Sources: apps/backend/tests/challengeHarness.ts and dataLabsCalibration.test.ts."
  },
  {
    "lesson": "replicas-do-not-take-writes@1",
    "field": "limitations.0",
    "text": "Results are educational model outputs. Generic Small assumes one core; db.t3.micro supplies two modeled cores and also changes query slots and session limits. This is a tier comparison, not a measured provider benchmark or credit simulation.",
    "values": [
      "db.t3.micro",
      "2"
    ],
    "reason": "db.t3.micro has two modeled vCPUs; the text explicitly qualifies this as an educational tier comparison. Source: packages/catalog/src/aws.catalog.ts; regression: apps/backend/tests/dataLabsCalibration.test.ts."
  },
  {
    "lesson": "keep-up-with-the-queue@1",
    "field": "explanation.2",
    "text": "Compare outstanding messages and acknowledgements in both reports. As a near miss, restore the starter and increase only queue capacity to 5000 messages; waiting room does not execute jobs.",
    "values": [
      "5000"
    ],
    "reason": "5000 messages is the tested queue-capacity-only near miss. Source: apps/backend/tests/asyncLabsCalibration.test.ts."
  },
  {
    "lesson": "leave-time-to-acknowledge@1",
    "field": "problem.0",
    "text": "The result can be written before the message is acknowledged. A one-second lease expires during the worker's two-second acknowledgement delay.",
    "values": [
      "2"
    ],
    "reason": "Two seconds is the unit conversion of the pinned 2000 ms ack delay, not another timing assumption. Source: pinned starter asyncWorker.acknowledgementDelayMs."
  },
  {
    "lesson": "leave-time-to-acknowledge@1",
    "field": "explanation.1",
    "text": "Select queue. Change only Visibility timeout from one to five seconds. Keep the 250 CPU milliseconds per job, 2000 millisecond acknowledgement delay, delivery limit and prefetch credit unchanged. Run again.",
    "values": [
      "5"
    ],
    "reason": "Five seconds is the tested visibility reference input; all other settings are fixed. Sources: apps/backend/tests/challengeHarness.ts and asyncLabsCalibration.test.ts."
  },
  {
    "lesson": "open-one-subscriber@1",
    "field": "explanation.1",
    "text": "Select queue. Under TCP listeners, enter 5672 in TCP listener ports and apply the ports. Change only this listener admission; run again.",
    "values": [
      "5672"
    ],
    "reason": "Port 5672 is the tested queue-listener reference input matching the saved bus connection. Sources: apps/backend/tests/challengeHarness.ts and asyncLabsCalibration.test.ts."
  },
  {
    "lesson": "find-the-denying-rule@1",
    "field": "explanation.2",
    "text": "Only after diagnosis, change quarantine-db priority from 0 to 20 on fw. Run again and compare admissions and caller outcomes. Try increasing only fw flow capacity as a separate near miss.",
    "values": [
      "20"
    ],
    "reason": "Priority 20 is the tested quarantine-rule reference input, not an admission measurement. Sources: apps/backend/tests/challengeHarness.ts and failureLabsCalibration.test.ts."
  },
  {
    "lesson": "choose-a-retry-mitigation@1",
    "field": "explanation.1",
    "text": "Change only lb Maximum attempts to 2 and run again. Restore the starter, change only Maximum attempts to 5 and run a third comparison. All three use the same authored partition and workload.",
    "values": [
      "2",
      "5"
    ],
    "reason": "Two and five attempts are the controlled alternative retry inputs, not the four-attempt starter. Sources: apps/backend/tests/challengeHarness.ts and failureLabsCalibration.test.ts."
  },
  {
    "lesson": "catalogue-link-flash@1",
    "field": "problem.0",
    "text": "A sixteen-key catalogue routes through DNS, a load balancer, an app and a database-backed cache. Its read-only traffic rises from 200 to 800 requests/second at 120 until 140. The mission evaluates at 125.",
    "values": [
      "120"
    ],
    "reason": "Second 120 begins the fixed 20-second peak; the end is second 140. Sources: packages/simulation/src/tuning.ts and apps/backend/tests/missionsCalibration.test.ts."
  },
  {
    "lesson": "catalogue-link-flash@1",
    "field": "problem.1",
    "text": "Fixed requirements: Healthy modeled overall health and completed-request p95 at most 4.5 ms in second 125. Educational assumptions: 3 ms app CPU/read, 1 ms database CPU/miss, one initial app core, a one-entry logical cache and a 60-second TTL.",
    "values": [
      "3",
      "60"
    ],
    "reason": "App reads use 3000 cpu-us and the cache default TTL is 60 seconds; these are educational canvas defaults outside the starter fields. Source: packages/simulation/src/model2/product/fromDesign.ts; regression: apps/backend/tests/missionsCalibration.test.ts."
  },
  {
    "lesson": "catalogue-link-flash@1",
    "field": "explanation.1",
    "text": "Use the earlier bottleneck and burst lessons to change only app to c5.xlarge. Run and compare. Then restore the starter and change only cache logical capacity from one entry to sixteen. Predict which requirement each partial design still misses.",
    "values": [
      "c5.xlarge"
    ],
    "reason": "c5.xlarge is the controlled app-only and combined reference input. Sources: apps/backend/tests/challengeHarness.ts and missionsCalibration.test.ts."
  },
  {
    "lesson": "flash-sale-order-backlog@1",
    "field": "problem.0",
    "text": "An order event is modeled as an object upload and queue publish. Traffic is four requests/second, sixteen during 120-140, then four again. A worker writes result objects. This supported journey has a direct producer app entry point.",
    "values": [
      "120",
      "140"
    ],
    "reason": "Second 120 begins the 20-second burst and 140 ends it. Sources: packages/simulation/src/tuning.ts and apps/backend/tests/missionsCalibration.test.ts."
  },
  {
    "lesson": "flash-sale-order-backlog@1",
    "field": "explanation.1",
    "text": "Apply the consumer-capacity lesson: change only worker CPU work to 100 ms/job. Run again, inspecting redeliveries and acknowledgements. Restore the starter; change only queue visibility to five seconds using the acknowledgement lesson. Run and inspect the remaining outstanding work.",
    "values": [
      "100",
      "5"
    ],
    "reason": "100 CPU ms/job and five-second visibility are separately controlled reference inputs and then combined. Sources: apps/backend/tests/challengeHarness.ts and missionsCalibration.test.ts."
  },
  {
    "lesson": "flash-sale-order-backlog@1",
    "field": "explanation.2",
    "text": "Combine both changes. Observe ready and in-flight work near second 140, then inspect the final report at 170. Arrivals continue, so a small in-flight population can remain after excess burst work has drained. Compare all four reports and explain why neither partial fix passes.",
    "values": [
      "140"
    ],
    "reason": "Second 140 is the end-of-burst live observation used in the controlled capture, not an asserted drain time. Source: apps/backend/tests/missionsCalibration.test.ts."
  }
];
