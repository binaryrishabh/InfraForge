// Real-browser walk through the learning pages against a LOCAL dev stack (http://localhost:5173 + api on :3000).
// Creates one disposable account on that local stack (generated password, never printed) and records what it saw.
// Run on the QA box: cd ~/qa/pw && JOURNEY_LAB=where-does-the-time-go node ../InfraForge/scripts/qa/learning-journey.mjs
// playwright-core is installed there. Omit JOURNEY_LAB to keep the original first-lab journey.
// Reading/concept mode: JOURNEY_KIND=lesson JOURNEY_LESSON=count-waiting-jobs node ../InfraForge/scripts/qa/learning-journey.mjs
// Choose a JOURNEY_LESSONS id below; this mode creates no challenge attempts.
// It only ever talks to localhost and refuses any other origin.
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// One row per lesson: workspace title, prediction/hypothesis, the exact resource and
// improvement control, and expected recorded verdict text (expectations, never results).
// Add labs here, reusing the shared steps below. Separate JOURNEY_SHOTS
// directories keep each lab's screenshots. The first row preserves the original choices.
// The original database row keeps its catalog choice. A separate journeyId exercises
// generic small -> medium on the same lesson. The run decides whether each meets the requirements.
export const JOURNEY_LABS = [
  {
    lessonId: "where-does-the-time-go", title: /Where does the time go\?/,
    prediction: "The app does three times the CPU work per read.",
    hypothesis: "A larger app instance gives the app more CPU, so its queue should shrink and p95 should fall.",
    improvement: {
      stepName: "the app's instance size is changed to c5.large in the designer",
      nodeSelector: ".react-flow__node, [data-id]", nodeText: /Virtual Machine/, fallbackText: "app",
      role: "radio", name: /c5\.large/i, resourceId: "app", setting: "skuId", from: null, to: "c5.large",
    },
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    lessonId: "writes-cost-more-than-reads", title: /Writes cost the database more/,
    prediction: "The write-heavy mix asks the database for more CPU work than the app.",
    hypothesis: "Changing only the database to db.m5.large adds database capacity, so its queue should shrink and p95 should fall.",
    improvement: {
      stepName: "the database size is changed to db.m5.large in the designer",
      nodeSelector: '[data-resource-id="db"]', nodeText: /Database/, fallbackText: "db",
      role: "radio", name: /db\.m5\.large/i, resourceId: "db", setting: "skuId", from: null, to: "db.m5.large",
    },
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    lessonId: "balancer-shares-turns", title: /The balancer shares turns/,
    prediction: "The smaller app-a receives half the turns and should make overall health worse than Healthy.",
    hypothesis: "Changing only app-a to c5.large matches app-b's capacity, so app-a's queue should shrink and p95 should fall.",
    improvement: {
      stepName: "app-a's instance size is changed to c5.large in the designer",
      nodeSelector: '[data-resource-id="app-a"]', nodeText: /Virtual Machine/, fallbackText: "app-a",
      role: "radio", name: /c5\.large/i, resourceId: "app-a", setting: "skuId", from: null, to: "c5.large",
    },
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    lessonId: "keep-waiting-work", title: /Keep waiting work/,
    prediction: "Final health alone cannot tell whether messages expired instead of being acknowledged.",
    hypothesis: "Keeping messages for 60 seconds lets the unchanged worker acknowledge more waiting work instead of losing it to expiry.",
    improvement: {
      stepName: "queue's message retention is changed from 1 to 60 seconds",
      nodeSelector: '[data-resource-id="queue"]', nodeText: /Message Queue/, fallbackText: "queue",
      role: "spinbutton", name: /^Message retention \(seconds\)$/, resourceId: "queue", setting: "asyncQueue.retentionSeconds", from: 1, to: 60,
    },
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    lessonId: "check-the-missing-server", title: /Check the missing server/,
    prediction: "The final health sample cannot erase callers that failed while the crashed server still received turns.",
    hypothesis: "Checking every second removes the crashed app from routing sooner, so more callers should reach the unchanged surviving server.",
    improvement: {
      stepName: "lb's health-check interval is changed from 60 to 1 second",
      nodeSelector: '[data-resource-id="lb"]', nodeText: /Load Balancer/, fallbackText: "lb",
      role: "spinbutton", name: /^Check interval \(seconds\)$/, resourceId: "lb", setting: "lbHealth.intervalSeconds", from: 60, to: 1,
    },
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    lessonId: "parallel-jobs-for-a-burst", title: /Parallel jobs for a burst/,
    prediction: "A Healthy worker with modest CPU can still leave burst work waiting when only one job runs at a time.",
    hypothesis: "Two parallel jobs use the worker's existing spare core, so acknowledgements should rise and outstanding work and ready age should fall.",
    improvement: {
      stepName: "worker's Jobs in parallel is changed from 1 to 2",
      nodeSelector: '[data-resource-id="worker"]', nodeText: /Virtual Machine/, fallbackText: "worker",
      role: "spinbutton", name: /^Jobs in parallel$/, resourceId: "worker", setting: "asyncWorker.concurrency", from: 1, to: 2,
    },
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    // The current-only lesson page now serves v3; v2 introduced the saved budget guidance.
    // Both versions use the same published challenge, starter and inspector controls.
    lessonId: "split-the-capacity-budget", title: /Split the capacity budget/,
    prediction: "The cheapest app should be busiest and the initial allocation should not record Healthy overall health.",
    predictionQuestions: [/Which resource type will record the highest CPU in second 6/, /What overall health will this allocation record in second 6/],
    hypothesis: "Sizing app and db together should remove both capacity constraints while keeping the recorded catalog estimate within $180. This pair changes two settings and cannot isolate either effect.",
    improvement: {
      stepName: "app and db are sized to the smaller passing DigitalOcean allocation",
      controls: [
        {
          // The starter's SKU selects DigitalOcean when this inspector mounts.
          nodeSelector: '[data-resource-id="app"]', nodeText: /Virtual Machine/, fallbackText: "app",
          role: "radio", name: /^Basic — 4 vCPU \/ 8 GB\b/, resourceId: "app", setting: "skuId", from: "s-1vcpu-512mb-10gb", to: "s-4vcpu-8gb",
        },
        {
          nodeSelector: '[data-resource-id="db"]', nodeText: /Database/, fallbackText: "db",
          role: "radio", name: /^Managed PG — 2 vCPU \/ 4 GB\b/, resourceId: "db", setting: "skuId", from: "db-s-1vcpu-1gb", to: "db-s-2vcpu-4gb",
        },
      ],
    },
    reportRequirements: [/^Catalog snapshot monthly estimate is at most \$180$/],
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    lessonId: "open-and-size-an-api", title: /Mission: open and size an API/,
    prediction: "The deny rule blocks database admission; opening it alone would still leave the small app short of CPU.",
    hypothesis: "Moving quarantine-db after the allow rule and resizing app to c5.large should permit the dependency and give it enough capacity. Two settings change, so this pair cannot isolate either effect.",
    improvement: {
      stepName: "quarantine-db priority is changed to 20 and app is sized to c5.large",
      controls: [
        {
          nodeSelector: '[data-resource-id="fw"]', nodeText: /Firewall/, fallbackText: "fw",
          group: /^quarantine-db$/, role: "spinbutton", name: /^Priority$/, resourceId: "fw", setting: "firewallSettings.rules.quarantine-db.priority", from: 0, to: 20,
        },
        {
          nodeSelector: '[data-resource-id="app"]', nodeText: /Virtual Machine/, fallbackText: "app",
          role: "radio", name: /c5\.large/i, resourceId: "app", setting: "skuId", from: null, to: "c5.large",
        },
      ],
    },
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    journeyId: "writes-cost-more-than-reads-generic",
    lessonId: "writes-cost-more-than-reads", title: /Writes cost the database more/,
    prediction: "The write-heavy mix asks the database for more CPU work than the app.",
    hypothesis: "Changing only the database from Generic Small to Generic Medium adds one assumed core, so its queue should shrink and p95 should fall.",
    improvement: {
      stepName: "the database size is changed to Generic Medium in the designer",
      nodeSelector: '[data-resource-id="db"]', nodeText: /Database/, fallbackText: "db",
      role: "radio", name: /^Generic Medium\b/, resourceId: "db", setting: "size", from: "small", to: "medium",
    },
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    lessonId: "size-the-app-database-pool", title: /Size the app database pool/,
    prediction: "The database can stay Healthy while the application waits for its transport pool.",
    hypothesis: "Two application database connections should reduce acquired pool wait and caller failures while the same CPUs have spare capacity.",
    improvement: {
      stepName: "db's Application database connections is changed from 1 to 2",
      nodeSelector: '[data-resource-id="db"]', nodeText: /Database/, fallbackText: "db",
      role: "spinbutton", name: /^Application database connections$/, resourceId: "db", setting: "dbPoolMaxConnections", from: 1, to: 2,
    },
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    lessonId: "restore-a-database-writer", title: /Restore a database writer/,
    prediction: "The replica needs explicit promotion; final health can hide earlier caller failures.",
    hypothesis: "Scheduling only the promotion after second 3 should restore writer work sooner while the returning primary stays fenced.",
    improvement: {
      stepName: "db's approved recovery plan schedules promotion after second 3",
      nodeSelector: '[data-resource-id="db"]', nodeText: /Database/, fallbackText: "db",
      role: "spinbutton", name: /^Promote at simulated second$/, resourceId: "db", setting: "databaseRecoveryPlan.promoteAtSecond", from: null, to: 3,
    },
    reportRequirements: [/^Complete at least 110 callers; at most 30 unsuccessful$/],
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    lessonId: "move-monitoring-samples", title: /Move monitoring samples/,
    prediction: "The service can stay Healthy while a fresh collector exports old observations to the backend.",
    hypothesis: "Changing only Export batch size should increase backend arrivals and reduce backend measurement age; a larger buffer alone cannot increase export throughput.",
    improvement: {
      stepName: "monitor's Export batch size is changed from 1 to 16",
      nodeSelector: '[data-resource-id="monitor"]', nodeText: /Monitoring Agent/, fallbackText: "monitor",
      role: "spinbutton", name: /^Export batch size$/, resourceId: "monitor", setting: "monitoringPolicy.batchSamples", from: 1, to: 16,
    },
    reportRequirements: [/^Receive 128 samples without drops or duplicates; backend ages at most 10 seconds$/],
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    lessonId: "object-bytes-versus-app-cpu", title: /Object bytes versus app CPU/,
    prediction: "The starter should record Critical health because the store refuses puts while producer CPU has spare capacity.",
    hypothesis: "Changing only stored data capacity from 1 to 4 MiB should admit checked puts and remove caller failures; background jobs can still wait.",
    improvement: {
      stepName: "store's Stored data capacity (MiB) is changed from 1 to 4",
      nodeSelector: '[data-resource-id="store"]', nodeText: /Object Storage/, fallbackText: "store",
      role: "spinbutton", name: /^Stored data capacity \(MiB\)$/, resourceId: "store", setting: "objectStoragePolicy.capacityMiB", from: 1, to: 4,
    },
    reportRequirements: [/^Complete at least 1100 callers; no unsuccessful callers$/],
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    lessonId: "restore-safe-redundancy", title: /Restore safe redundancy/,
    prediction: "Service can finish Healthy while the returning old primary stays fenced and redundancy remains missing.",
    hypothesis: "Changing only Old-primary catch-up to snapshot and ordered replay should restore a caught-up replica while preserving the promoted writer and earlier recorded loss.",
    improvement: {
      stepName: "db's Old-primary catch-up enables snapshot and ordered replay",
      nodeSelector: '[data-resource-id="db"]', nodeText: /Database/, fallbackText: "db",
      role: "combobox", name: /^Old-primary catch-up$/, resourceId: "db", setting: "databaseReplication.rejoin", from: null, to: "snapshot-replay/1",
    },
    reportRequirements: [/^At second 64, returned replica caught up with exactly one promoted writer$/],
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    lessonId: "resolve-after-publication", title: /Resolve after publication/,
    prediction: "Final Healthy service can coexist with earlier unresolved caller failures.",
    hypothesis: "A one-second resolver ceiling should expire negative answers sooner so later connection opens discover the unchanged published record.",
    improvement: {
      stepName: "dns's Maximum cached TTL is changed from 60 to 1 second",
      nodeSelector: '[data-resource-id="dns"]', nodeText: /DNS/, fallbackText: "dns",
      role: "spinbutton", name: /^Maximum cached TTL \(seconds\)$/, resourceId: "dns", setting: "dnsCachePolicy.maxTtlSeconds", from: 60, to: 1,
    },
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    lessonId: "scale-on-delivered-samples", title: /Scale on delivered samples/,
    prediction: "The pool should not gain an app server while its delivered measurements are too old for the autoscaler to use.",
    hypothesis: "Changing only the monitor's export interval from 20 to 2 seconds should deliver fresh measurements so the pool adds a server; lowering the CPU target alone cannot.",
    improvement: {
      stepName: "monitor's Export every (seconds) is changed from 20 to 2",
      nodeSelector: '[data-resource-id="monitor"]', nodeText: /Monitoring Agent/, fallbackText: "monitor",
      role: "spinbutton", name: /^Export every \(seconds\)$/, resourceId: "monitor", setting: "monitoringPolicy.exportIntervalSeconds", from: 20, to: 2,
    },
    reportRequirements: [/^The pool has at least 2 app servers in service at second 90$/],
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    lessonId: "isolate-route-credits", title: /Isolate route credits/,
    prediction: "Overall health stays Critical because read callers are deliberately throttled despite low CPU.",
    hypothesis: "Separate route buckets stop reads spending write credits, increasing write completions while increasing the aggregate quota.",
    improvement: {
      stepName: "gateway quota scope changes from shared to per-route",
      nodeSelector: '[data-resource-id="gateway"]', nodeText: /API Gateway/, fallbackText: "gateway",
      role: "combobox", name: /^Quota scope$/, resourceId: "gateway", setting: "gatewayQuota.scope", from: "shared", to: "per-route",
    },
    reportRequirements: [/^Complete at least 45 reads with no upstream failures$/, /^Complete at least 45 writes with no upstream failures$/],
    expected: {starter: "Not met", improved: "Met"},
  },
  {
    lessonId: "redrive-after-the-fix", title: /Redrive after the fix/,
    prediction: "The queue should finish with many messages still dead-lettered because the redrive runs before the repair.",
    hypothesis: "Changing only the redrive second to after the repair should let redriven messages succeed; raising the delivery limit alone cannot.",
    improvement: {
      stepName: "queue's Redrive dead-lettered messages at second is changed from 20 to 45",
      nodeSelector: '[data-resource-id="queue"]', nodeText: /Message Queue/, fallbackText: "queue",
      role: "spinbutton", name: /^Redrive dead-lettered messages at second$/, resourceId: "queue", setting: "asyncQueue.redriveAtSecond", from: 20, to: 45,
    },
    reportRequirements: [/^Acknowledge 700; at most 10 outstanding by second 90$/],
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    lessonId: "keep-failed-events", title: /Keep failed events/,
    prediction: "Most failed events should be discarded because the bus's dead-letter list is tiny.",
    hypothesis: "Changing only the dead-letter list size should keep the failed events; more delivery attempts cannot.",
    improvement: {
      stepName: "bus's Dead letters per subscription is changed from 5 to 100",
      nodeSelector: '[data-resource-id="bus"]', nodeText: /Event Bus/, fallbackText: "bus",
      role: "spinbutton", name: /^Dead letters per subscription$/, resourceId: "bus", setting: "eventBus.deadLetterCapacity", from: 5, to: 100,
    },
    reportRequirements: [/^Keep at least 50 failed events and discard none by second 30$/],
    expected: { starter: "Not met", improved: "Met" },
  },
  {
    lessonId: "share-one-origin-fetch", title: /Share one origin fetch/,
    prediction: "Callers complete either way, but the origin gets extra requests every time the object expires.",
    hypothesis: "Turning on coalescing alone should cut origin requests; a longer TTL would also but breaks the freshness requirement.",
    improvement: {
      stepName: "cdn's Coalesce concurrent misses is turned on",
      nodeSelector: '[data-resource-id="cdn"]', nodeText: /CDN/, fallbackText: "cdn",
      role: "switch", name: /^Coalesce concurrent misses$/, resourceId: "cdn", setting: "cdnCachePolicy.coalesce", from: false, to: true,
    },
    reportRequirements: [/^At most 90 origin requests by second 60 with a TTL of one second or less$/],
    expected: { starter: "Not met", improved: "Met" },
  },
];

// Cache working set: JOURNEY_LAB=fit-the-working-set JOURNEY_SHOTS=/tmp/fit-working-set node ../InfraForge/scripts/qa/learning-journey.mjs
JOURNEY_LABS.push({
  lessonId: "fit-the-working-set", title: /Fit the working set/,
  prediction: "Most reads miss because the cache evicts entries it needs, so the database is busy and degraded.",
  hypothesis: "Diagnosis: 16 cache entries cannot hold 256 keys, so evictions keep reads missing and the database works. Raising only Logical cache capacity to 256 should let reads be reused and cut database CPU and the tail.",
  improvement: {
    stepName: "cache's Logical cache capacity is changed from 16 to 256",
    nodeSelector: '[data-resource-id="cache"]', nodeText: /Cache/, fallbackText: "cache",
    role: "spinbutton", name: /^Logical cache capacity/, resourceId: "cache", setting: "cachePolicy.capacityEntries", from: 16, to: 256,
  },
  expected: {starter: "Not met", improved: "Met"},
});
// Edge admission: JOURNEY_LAB=shed-load-at-the-edge JOURNEY_SHOTS=/tmp/shed-load node ../InfraForge/scripts/qa/learning-journey.mjs
JOURNEY_LABS.push({
  lessonId: "shed-load-at-the-edge", title: /Shed load at the edge/,
  prediction: "A busy app that finishes some callers is still critical: most fail and the final-second tail is long.",
  hypothesis: "Diagnosis: the balancer admits nearly all demand, so the excess waits in the saturated app and the final-second p95 is long. Lowering only Active requests should refuse the excess at the balancer and shorten the tail while completions stay about the same.",
  improvement: {
    stepName: "lb's Active requests is changed from 1024 to 16",
    nodeSelector: '[data-resource-id="lb"]', nodeText: /Load Balancer/, fallbackText: "lb",
    role: "spinbutton", name: /^Active requests$/, resourceId: "lb", setting: "lbAdmission.maxActive", from: 1024, to: 16,
  },
  expected: {starter: "Not met", improved: "Met"},
});
// Held capacity: run the full retained learning loop against the local QA stack.
// JOURNEY_LAB=hold-slots-on-a-slow-call JOURNEY_SHOTS=/tmp/hold-slots node ../InfraForge/scripts/qa/learning-journey.mjs
JOURNEY_LABS.push({
  lessonId: "hold-slots-on-a-slow-call", title: /Hold slots on a slow call/,
  prediction: "Low worker CPU does not mean the worker keeps up: one job at a time holds its slot during a 450 ms external wait and the backlog grows.",
  hypothesis: "Diagnosis: worker CPU is low but each job holds its only parallel slot about 500 ms, so about two jobs a second finish against four arriving. Increasing only Jobs in parallel should raise acknowledgements and cut outstanding work.",
  improvement: {
    stepName: "worker's Jobs in parallel is changed from 1 to 4",
    nodeSelector: '[data-resource-id="worker"]', nodeText: /Virtual Machine/, fallbackText: "worker",
    role: "spinbutton", name: /^Jobs in parallel$/, resourceId: "worker", setting: "asyncWorker.concurrency", from: 1, to: 4,
  },
  expected: {starter: "Not met", improved: "Met"},
});
// Artifact admission: JOURNEY_LAB=admit-a-replica-image JOURNEY_SHOTS=/tmp/artifact-admission node ../InfraForge/scripts/qa/learning-journey.mjs
JOURNEY_LABS.push({
  lessonId: "admit-a-replica-image", title: /Admit a replica image/,
  prediction: "The initial app can stay Healthy while app#1/image refuses its required 1024-byte layer in a 256-byte cache.",
  hypothesis: "Diagnosis: app#1/image reports node-blob-cache-capacity and no artifact or listener readiness. Increasing only its saved cache bytes should admit the layer and make the later replica listener-ready and LB-eligible; equal caller totals can remain.",
  improvement: {
    stepName: "app's Artifact cache capacity (bytes) changes from 256 to 4096",
    nodeSelector: '[data-resource-id="app"]', nodeText: /Virtual Machine/, fallbackText: "app",
    role: "spinbutton", name: /^Artifact cache capacity \(bytes\)$/, resourceId: "app", setting: "artifactCachePolicy.capacityBytes", from: 256, to: 4096,
  },
  reportRequirements: [/^At least one later replica is listener-ready and currently LB-eligible at second 20$/],
  expected: {starter: "Not met", improved: "Met"},
});

// JOURNEY_LAB=keep-a-function-warm JOURNEY_SHOTS=./nx13-shots node ../InfraForge/scripts/qa/learning-journey.mjs
JOURNEY_LABS.push({
  lessonId: "keep-a-function-warm", title: /Keep a function warm/,
  prediction: "Overall health stays Healthy even though each sparse call pays cold initialization.",
  hypothesis: "Diagnosis: idle instances expire before the next sparse call. Increasing only idle expiry should preserve a warm instance and reduce cold starts; more concurrency alone cannot prevent expiry.",
  improvement: {
    stepName: "fn's Warm instance idle expiry (ms) changes from 100 to 5000",
    nodeSelector: '[data-resource-id="fn"]', nodeText: /Serverless Function/, fallbackText: "fn",
    role: "spinbutton", name: /^Warm instance idle expiry \(ms\)$/, resourceId: "fn", setting: "serverless.idleExpiryMs", from: 100, to: 5000,
  },
  reportRequirements: [/^Complete 7 invocations with at most 2 cold starts and no unsuccessful invocations$/],
  expected: {starter: "Not met", improved: "Met"},
});

JOURNEY_LABS.push({
  lessonId: "open-the-forwarding-gate", title: /Open the forwarding gate/,
  prediction: "The app can have the highest known CPU while the active forwarding gate limits callers. LB CPU is Unknown.",
  hypothesis: "Diagnosis: one active slot serializes round trips ahead of spare backend capacity. Increasing only Active requests should reduce LB waits and failures; a bigger waiting queue does not open that gate.",
  improvement: {
    stepName: "lb's Active requests changes from 1 to 16",
    nodeSelector: '[data-resource-id="lb"]', nodeText: /Load Balancer/, fallbackText: "lb",
    role: "spinbutton", name: /^Active requests$/, resourceId: "lb", setting: "lbAdmission.maxActive", from: 1, to: 16,
  },
  reportRequirements: [/^Complete 1700; at most 10 unsuccessful through second 6$/],
  expected: {starter: "Not met", improved: "Met"},
});

// Representative conceptual content, plus a reading without a check.
// These are UI expectations pinned to authored text, never simulated results.
export const JOURNEY_LESSONS = [
  {
    "lessonId": "client-and-server",
    "title": "Client and server",
    "kind": "conceptual-exercise",
    "trackId": "foundations",
    "prerequisites": [
      {
        "lessonId": "what-is-a-request",
        "title": "What is a request?"
      }
    ],
    "limitations": [
      "This exercise reasons about program roles. It does not run a browser, application service or database."
    ],
    "check": {
      "question": "When the notes service asks the database for text, what role does the notes service have in that exchange?",
      "wrong": "Server: it must have the same role in every exchange.",
      "correct": "Client: it initiates the database request.",
      "explanation": "The service handles the browser's request, but initiates the separate database request as a client."
    },
    "next": {
      "lessonId": "dns-resolution",
      "title": "DNS: finding an address"
    }
  },
  {
    "lessonId": "count-waiting-jobs",
    "title": "Count the waiting jobs",
    "kind": "conceptual-exercise",
    "trackId": "async",
    "prerequisites": [
      {
        "lessonId": "why-work-waits",
        "title": "Why work waits in a queue"
      }
    ],
    "limitations": [
      "Conceptual only: the arithmetic and lost acknowledgement are hypothetical, not recorded simulator evidence. No real queue's delivery, retention or duplicate-handling guarantee is established.",
      "Later labs model logical messages and object effects. They do not demonstrate payments, exactly-once business actions or physical persistence."
    ],
    "check": {
      "question": "Which conclusion follows from these assumptions?",
      "wrong": "Twice the waiting room makes the worker finish four jobs each second.",
      "correct": "Twenty jobs remain unfinished; a repeated delivery could repeat an action.",
      "explanation": "Waiting room changes neither the worker's rate nor acknowledgement uncertainty. Forty arrivals minus twenty completions leaves twenty unfinished jobs under the stated no-loss assumptions."
    },
    "next": {
      "lessonId": "keep-waiting-work",
      "title": "Let waiting work stay"
    }
  },
  {
    "lessonId": "missing-failure-observations",
    "title": "Name what failure evidence is missing",
    "kind": "conceptual-exercise",
    "trackId": "failures",
    "prerequisites": [
      {
        "lessonId": "first-bottleneck",
        "title": "Finding the first bottleneck"
      }
    ],
    "limitations": [
      "This exercise supplies no incident diagnosis. Even a matching admission counter describes modeled decisions and may include probes rather than only application callers."
    ],
    "check": {
      "question": "What is the honest conclusion when the needed path counter was not recorded?",
      "wrong": "There were zero denials.",
      "correct": "The admission cause remains Unknown; name the missing observation.",
      "explanation": "Missing observations cannot support a zero or a specific cause. State the limit and investigate the measurement that would distinguish explanations."
    },
    "next": {
      "lessonId": "mitigation-tradeoffs",
      "title": "Choose a mitigation with a tradeoff"
    }
  },
  {
    "lessonId": "choose-the-constrained-tier",
    "title": "Choose the constrained tier",
    "kind": "conceptual-exercise",
    "trackId": "scaling",
    "prerequisites": [
      {
        "lessonId": "up-or-out",
        "title": "A bigger machine or more machines"
      },
      {
        "lessonId": "database-read-and-write",
        "title": "A database read and a write"
      }
    ],
    "limitations": [
      "Conceptual only: the busy database and unequal servers are thought experiments, not recorded simulator outcomes.",
      "The exercise assumes independent app requests and unchanged database work. It proves no production scaling factor, automatic scaling behavior, state-sharing strategy or availability guarantee."
    ],
    "check": {
      "question": "For the original shared-database case, which next experiment addresses the named constraint?",
      "wrong": "Add an app server; shared turns automatically add database execution capacity.",
      "correct": "Keep arrivals and apps fixed; change database capacity and compare useful completions and waiting.",
      "explanation": "The hypothetical constraint is database execution. Changing that tier tests the diagnosis; adding app machines or waiting room does not supply database capacity. A different bottleneck may remain afterward."
    },
    "next": {
      "lessonId": "load-balancer-policies",
      "title": "What a load balancer policy decides"
    }
  },
  {
    "lessonId": "locate-the-missing-wait",
    "title": "Locate the missing wait",
    "kind": "conceptual-exercise",
    "trackId": "diagnosis",
    "prerequisites": [
      {
        "lessonId": "queue-ownership-and-acknowledgement",
        "title": "Queue acceptance is not acknowledgement"
      },
      {
        "lessonId": "waiting-with-spare-cpu",
        "title": "Read latency alongside CPU"
      },
      {
        "lessonId": "trace-a-saturation-cascade",
        "title": "Trace a saturation cascade"
      }
    ],
    "limitations": [
      "This exercise has no executable experiment and asserts no simulated outcome. Spare CPU and a slow reply alone cannot prove slot exhaustion, a full transport pool, a particular downstream cause or an effective fix.",
      "Existing worker-slot and database-pressure labs test their stated mechanisms. Reusing their results would not prove path-specific dependency holding here. A process outage and a slow dependency are distinct hypotheses; neither establishes message age or recovery time."
    ],
    "check": {
      "question": "What is needed before attributing low-CPU waiting specifically to held app slots?",
      "wrong": "A lower app CPU percentage alone",
      "correct": "Slot occupancy and waiting phases, correlated with dependency and per-path pool measurements",
      "explanation": "CPU and open connections describe different populations. Holding a worker slot across a dependency wait needs phase and occupancy observations; absent attribution remains Unknown."
    },
    "next": {
      "lessonId": "diagnose-consumer-credit",
      "title": "Diagnose consumer credit"
    }
  },
  {
    "lessonId": "what-is-a-request",
    "title": "What is a request?",
    "kind": "reading",
    "trackId": "foundations",
    "prerequisites": [],
    "limitations": [
      "This is a conceptual introduction. It does not send network traffic, measure timing or demonstrate a particular protocol."
    ],
    "check": null,
    "next": {
      "lessonId": "client-and-server",
      "title": "Client and server"
    }
  }
];

export function journeyLab(id = "where-does-the-time-go") {
  const lab = JOURNEY_LABS.find((entry) => (entry.journeyId ?? entry.lessonId) === id);
  if (!lab) throw new Error(`Unknown JOURNEY_LAB. Choose: ${JOURNEY_LABS.map((entry) => entry.journeyId ?? entry.lessonId).join(", ")}`);
  return lab;
}

export function journeyLesson(id = "client-and-server") {
  const lesson = JOURNEY_LESSONS.find((entry) => entry.lessonId === id);
  if (!lesson) throw new Error(`Unknown JOURNEY_LESSON. Choose: ${JOURNEY_LESSONS.map((entry) => entry.lessonId).join(", ")}`);
  return lesson;
}

export function selectJourney(env = {}) {
  const kind = env.JOURNEY_KIND ?? "lab";
  if (kind === "failure") {
    if (env.JOURNEY_LAB !== undefined || env.JOURNEY_LESSON !== undefined) throw new Error("JOURNEY_FAILURE cannot be combined with JOURNEY_LAB or JOURNEY_LESSON");
    return { kind, entry: journeyFailure(env.JOURNEY_FAILURE) };
  }
  if (env.JOURNEY_FAILURE !== undefined) throw new Error("JOURNEY_FAILURE requires JOURNEY_KIND=failure");
  if (!["lab", "lesson"].includes(kind)) throw new Error("Unknown JOURNEY_KIND. Choose: lab, lesson, failure");
  if (kind === "lesson") {
    if (env.JOURNEY_LAB !== undefined) throw new Error("JOURNEY_LAB cannot be combined with JOURNEY_KIND=lesson");
    return { kind, entry: journeyLesson(env.JOURNEY_LESSON) };
  }
  if (env.JOURNEY_LESSON !== undefined) throw new Error("JOURNEY_LESSON requires JOURNEY_KIND=lesson");
  return { kind, entry: journeyLab(env.JOURNEY_LAB) };
}

const SAVED_LESSON_NOTE = "Reading mark and check answers: saved on this device. These are personal notes, not server progress or mastery.";
const NO_CHECK_MESSAGE = "This lesson has no check question. Try explaining the problem in your own words.";
const lessonPath = (lesson) => `/learn/lessons/${encodeURIComponent(lesson.lessonId)}`;
const waitVisible = (locator) => locator.waitFor({ state: "visible", timeout: 30_000 });

async function requireChecked(locator, description) {
  await waitVisible(locator);
  if (!await locator.isChecked()) throw new Error(`${description} was not retained`);
}

async function requireReadMark(page) {
  const mark = page.getByRole("button", { name: "Remove read mark", exact: true });
  await waitVisible(mark);
  if (await mark.getAttribute("aria-pressed") !== "true") throw new Error("Read mark was not retained");
  await waitVisible(page.getByText(SAVED_LESSON_NOTE, { exact: true }));
}

async function requireNoLessonRun(page) {
  for (const locator of [
    page.getByRole("button", { name: "Open challenge lab", exact: true }),
    page.getByRole("heading", { name: "Experiment", exact: true }),
    page.getByRole("heading", { name: "Evidence to inspect", exact: true }),
    page.getByText(/^Server activity:/),
  ]) if (await locator.count()) throw new Error("Conceptual lesson exposes a lab or server activity claim");
}

async function requireNoCheck(page) {
  await waitVisible(page.getByText(NO_CHECK_MESSAGE, { exact: true }));
  if (await page.getByRole("radio").count()) throw new Error("No-check reading exposes check answers");
}

// Only public UI controls are used. No storage injection, API answers or server-progress inference.
// `step` records browser observations in the CLI; fake-page tests exercise selectors only.
export async function walkJourneyLesson(page, lesson, { web, shots, step }) {
  await step("open the selected lesson from the learning list", async () => {
    await page.goto(`${web}/learn`, { waitUntil: "load" });
    const link = page.getByRole("link", { name: lesson.title, exact: true });
    await waitVisible(link);
    if (await link.getAttribute("href") !== lessonPath(lesson)) throw new Error("Learning list points to a different lesson");
    await link.click();
    await page.waitForURL(`${web}${lessonPath(lesson)}`, { timeout: 30_000 });
    await waitVisible(page.getByRole("heading", { level: 1, name: lesson.title, exact: true }));
    return { lessonId: lesson.lessonId, kind: lesson.kind };
  });
  await step("read the limitations and suggested prerequisites", async () => {
    for (const name of ["Problem", "Plain explanation", "Prediction prompt", "Limitations", "Follow-up", "Check question"]) {
      await waitVisible(page.getByRole("heading", { name, exact: true }));
    }
    for (const text of lesson.limitations) await waitVisible(page.getByText(text, { exact: true }));
    const prerequisites = page.getByRole("complementary", { name: "Suggested prerequisites", exact: true });
    await waitVisible(prerequisites.getByText("Prerequisites are advice, not locks.", { exact: true }));
    for (const prerequisite of lesson.prerequisites) {
      const link = prerequisites.getByRole("link", { name: prerequisite.title, exact: true });
      await waitVisible(link);
      if (await link.getAttribute("href") !== lessonPath(prerequisite)) throw new Error("Incorrect prerequisite link");
    }
    // Wait for catalog-backed follow-up links even for the reading with no prerequisites.
    await waitVisible(page.getByRole("link", { name: `Next in track order: ${lesson.next.title}`, exact: true }));
    if (await prerequisites.getByRole("link").count() !== lesson.prerequisites.length) throw new Error("Unexpected prerequisite links");
    await requireNoLessonRun(page);
    await page.screenshot({ path: `${shots}/lesson-content.png`, fullPage: true });
    return { limitations: lesson.limitations, prerequisites: lesson.prerequisites };
  });
  if (lesson.check) {
    await step("a wrong answer gives the revisit explanation", async () => {
      const group = page.getByRole("group", { name: lesson.check.question, exact: true });
      const wrong = group.getByRole("radio", { name: lesson.check.wrong, exact: true });
      await wrong.check();
      await requireChecked(wrong, "Wrong answer");
      await waitVisible(group.getByRole("status").filter({ hasText: `Revisit the explanation. ${lesson.check.explanation}` }));
      await waitVisible(page.getByText(SAVED_LESSON_NOTE, { exact: true }));
      await page.screenshot({ path: `${shots}/lesson-revisit.png`, fullPage: true });
      return { answer: lesson.check.wrong, explanation: lesson.check.explanation };
    });
    await step("the matching answer replaces the wrong answer and is saved on this device", async () => {
      const group = page.getByRole("group", { name: lesson.check.question, exact: true });
      const correct = group.getByRole("radio", { name: lesson.check.correct, exact: true });
      await correct.check();
      await requireChecked(correct, "Matching answer");
      if (await group.getByRole("radio", { name: lesson.check.wrong, exact: true }).isChecked()) throw new Error("Wrong answer is still selected");
      await waitVisible(group.getByRole("status").filter({ hasText: `That matches the explanation. ${lesson.check.explanation}` }));
      await waitVisible(page.getByText(SAVED_LESSON_NOTE, { exact: true }));
      await page.screenshot({ path: `${shots}/lesson-matching.png`, fullPage: true });
      return { answer: lesson.check.correct, storage: "device-local personal note" };
    });
  } else {
    await step("the reading explicitly has no check question", async () => {
      await requireNoCheck(page);
      return { message: NO_CHECK_MESSAGE };
    });
  }
  await step("mark the lesson as read on this device", async () => {
    await page.getByRole("button", { name: "Mark as read", exact: true }).click();
    await requireReadMark(page);
    return { read: true, storage: "device-local personal note" };
  });
  await step("reload restores the read mark and matching answer without server progress", async () => {
    await page.reload({ waitUntil: "load" });
    await waitVisible(page.getByRole("heading", { level: 1, name: lesson.title, exact: true }));
    await requireReadMark(page);
    if (lesson.check) {
      const group = page.getByRole("group", { name: lesson.check.question, exact: true });
      await requireChecked(group.getByRole("radio", { name: lesson.check.correct, exact: true }), "Reloaded matching answer");
      if (await group.getByRole("radio", { name: lesson.check.wrong, exact: true }).isChecked()) throw new Error("Reload restored the wrong answer");
      await waitVisible(group.getByRole("status").filter({ hasText: `That matches the explanation. ${lesson.check.explanation}` }));
    } else await requireNoCheck(page);
    await requireNoLessonRun(page);
    await page.screenshot({ path: `${shots}/lesson-reloaded.png`, fullPage: true });
    return { restoredReadMark: true, restoredMatchingAnswer: lesson.check ? true : null };
  });
  await step("follow the next lesson in track order", async () => {
    const link = page.getByRole("link", { name: `Next in track order: ${lesson.next.title}`, exact: true });
    await waitVisible(link);
    if (await link.getAttribute("href") !== lessonPath(lesson.next)) throw new Error("Incorrect next lesson link");
    await link.click();
    await page.waitForURL(`${web}${lessonPath(lesson.next)}`, { timeout: 30_000 });
    await waitVisible(page.getByRole("heading", { level: 1, name: lesson.next.title, exact: true }));
    await page.screenshot({ path: `${shots}/lesson-next.png`, fullPage: true });
    return { nextLessonId: lesson.next.lessonId };
  });
}

export function isLocalJourneyRequest(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "localhost";
  } catch { return false; }
}

export async function changeJourneyControl(page, improvement) {
  if (!["radio", "spinbutton", "combobox", "switch"].includes(improvement.role)) throw new Error(`Unsupported journey control role: ${improvement.role}`);
  await page.locator(improvement.nodeSelector).filter({ hasText: improvement.nodeText }).first().click({ timeout: 20_000 }).catch(async () => {
    await page.getByText(improvement.fallbackText, { exact: true }).first().click();
  });
  const scope = improvement.group ? page.getByRole("group", { name: improvement.group }) : page;
  const size = scope.getByRole(improvement.role, { name: improvement.name }).first();
  await size.waitFor({ timeout: 20_000 });
  if (improvement.role === "spinbutton") await size.fill(String(improvement.to));
  else if (improvement.role === "combobox") await size.selectOption(String(improvement.to));
  else if (improvement.role === "switch") { if (!(await size.isChecked())) await size.click(); }
  else await size.check();
  return size;
}

export async function applyJourneyImprovement(page, improvement) {
  const chosen = [];
  for (const edit of improvement.controls ?? [improvement]) {
    const control = await changeJourneyControl(page, edit);
    const flag = edit.role === "radio" || edit.role === "switch";
    const value = flag ? await control.isChecked() : await control.inputValue();
    if (!improvement.controls && edit.role === "radio") return value;
    if (value !== (flag ? true : String(edit.to))) throw new Error(`Journey control did not retain ${edit.resourceId}.${edit.setting}`);
    chosen.push({ resourceId: edit.resourceId, setting: edit.setting, value });
  }
  return chosen;
}

export async function answerJourneyPredictions(dialog, lab) {
  if (!lab.predictionQuestions) return dialog.getByRole("radio").first().check();
  for (const name of lab.predictionQuestions) await dialog.getByRole("group", { name }).getByRole("radio").first().check();
}

export async function acknowledgeJourneyChanges(dialog, improvement) {
  if (improvement.controls?.length > 1) {
    // The real review must finish and expose its consent; never bypass the server's review.
    await dialog.getByRole("checkbox", { name: "Continue deliberately with these changes", exact: true }).check({ timeout: 120_000 });
  }
}

export async function inspectJourneyRequirements(page, lab) {
  if (!lab.reportRequirements) return [];
  // The summary text is "› Full evidence record" (the arrow is a child span), so match it by contained text, not exact text.
  const record = page.locator("details").filter({ has: page.locator("summary", { hasText: "Full evidence record" }) });
  await record.locator("summary").first().click();
  const details = [];
  for (const name of lab.reportRequirements) {
    // The result hero repeats the requirement label without its saved amount or source.
    const row = record.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) }).first();
    await row.waitFor({ timeout: 30_000 });
    details.push(await row.innerText());
  }
  return details;
}

// Failure mode injects only these local API failures. The rows are expectations,
// not observed browser results. Fake-page tests prove selectors/interception only.
// QA: JOURNEY_KIND=failure JOURNEY_FAILURE=<id> node ../InfraForge/scripts/qa/learning-journey.mjs
export const JOURNEY_FAILURES = [
  { id: "lesson-list-load", flow: "list", method: "GET", path: "/learning", status: 500,
    message: "Local QA: learning list unavailable.", alert: "Learning could not be loaded. Try again.", recovery: "Try again" },
  { id: "lesson-open-load", flow: "lesson", method: "GET", path: "/learning/lessons/client-and-server", status: "abort",
    alert: "This lesson could not be loaded. It may be unavailable. Try again.", recovery: "Try again" },
  { id: "check-session-expired", flow: "check-session", method: "GET", path: "/learning", status: 401,
    message: "Local QA: session ended.", recovery: "Sign in" },
  { id: "run-start-refused", flow: "start", method: "POST", path: "/challenges/keep-waiting-work/attempts", status: 429,
    message: "Local QA: no run slot is available. Try again later.", recovery: "Lock prediction and run" },
  { id: "run-start-error", flow: "start", method: "POST", path: "/challenges/keep-waiting-work/attempts", status: 500,
    message: "Local QA: the start could not be confirmed.", recovery: "Check Runs before trying again" },
  { id: "run-start-session-expired", flow: "start-session", method: "POST", path: "/challenges/keep-waiting-work/attempts", status: 401,
    message: "Local QA: session ended.", recovery: "Sign in" },
  { id: "reload-mid-run", flow: "reload", method: null, path: null, status: null, recovery: "Start it again" },
  { id: "browser-input-load", flow: "browser-input", method: "GET", path: /^\/deployments\/[^/]+\/browser-run$/, status: 500,
    message: "Local QA: browser input unavailable.", alert: "The simulation has not started yet", recovery: "This page keeps trying." },
  { id: "run-delivery-busy", flow: "delivery", method: "POST", path: /^\/deployments\/[^/]+\/submit$/, status: 429,
    message: "Local QA: replay queue busy.", alert: "We could not confirm your run was saved", recovery: "Send again", attempts: 8 },
];

export function journeyFailure(id = "lesson-list-load") {
  const entry = JOURNEY_FAILURES.find(entry => entry.id === id);
  if (!entry) throw new Error(`Unknown JOURNEY_FAILURE. Choose: ${JOURNEY_FAILURES.map(entry => entry.id).join(", ")}`);
  return entry;
}

export function localFailureApi(api = "http://localhost:3000/api") {
  if (!/^http:\/\/localhost:\d+\/api$/.test(api)) throw new Error("failure injection only runs against a localhost API ending in /api");
  return api;
}

// Page routes take precedence over context routes: refuse remote requests here
// too, and use fallback (never continue) for everything we did not inject so the
// existing context guard remains in force. OPTIONS/auth/other APIs pass through.
export async function installJourneyFailure(page, entry, api = "http://localhost:3000/api", { armed = true } = {}) {
  localFailureApi(api);
  if (!JOURNEY_FAILURES.includes(entry)) throw new Error("Failure must be a registered JOURNEY_FAILURES row");
  let enabled = armed;
  const injected = [];
  const injectedRequests = new Map();
  const pendingConsole = [];
  const matches = request => {
    const url = new URL(request.url()), base = new URL(api);
    const path = url.pathname.slice(base.pathname.length);
    return url.origin === base.origin && url.pathname.startsWith(`${base.pathname}/`)
      && request.method() === entry.method && (typeof entry.path === "string" ? path === entry.path : entry.path?.test(path));
  };
  const handler = async route => {
    const request = route.request();
    if (!isLocalJourneyRequest(request.url())) return route.abort("blockedbyclient");
    if (!enabled || !matches(request)) return route.fallback();
    const hit = { url: request.url(), method: request.method(), status: entry.status };
    injected.push(hit); pendingConsole.push(hit); injectedRequests.set(request, entry.status);
    if (entry.status === "abort") return route.abort("failed");
    const origin = request.headers().origin;
    return route.fulfill({ status: entry.status, contentType: "application/json", body: JSON.stringify({ message: entry.message }),
      headers: /^http:\/\/localhost:\d+$/.test(origin ?? "")
        ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" } : {} });
  };
  await page.route("**/*", handler);
  return {
    injected,
    arm() { enabled = true; },
    release() { enabled = false; },
    assertInjected() { if (!injected.length) throw new Error(`Failure route was not exercised: ${entry.id}`); },
    expectedResponse(response) { return injectedRequests.has(response.request()) && injectedRequests.get(response.request()) === response.status(); },
    expectedConsole(message) {
      // Only Chromium's resource error for an exact injected URL/status is expected.
      const url = message.location().url, text = message.text();
      const at = pendingConsole.findIndex(hit => hit.url === url && (hit.status === "abort"
        ? /^Failed to load resource: net::ERR_FAILED$/.test(text)
        : text === `Failed to load resource: the server responded with a status of ${hit.status} (${({ 401: "Unauthorized", 429: "Too Many Requests", 500: "Internal Server Error" })[hit.status]})`));
      if (at < 0) return false;
      pendingConsole.splice(at, 1);
      return true;
    },
    async dispose() { await page.unroute("**/*", handler); },
  };
}

async function walkJourneyFailure(page, entry, { web, api, shots, step, signIn, observe }) {
  const injection = await installJourneyFailure(page, entry, api, { armed: entry.flow !== "check-session" });
  observe(injection);
  const lesson = journeyLesson(), lab = journeyLab("keep-waiting-work");
  const showLesson = async () => {
    await page.goto(`${web}${lessonPath(lesson)}`, { waitUntil: "load" });
    await waitVisible(page.getByRole("heading", { level: 1, name: lesson.title, exact: true }));
  };
  const retry = async () => {
    injection.assertInjected(); injection.release();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
  };
  const dialog = () => page.getByRole("dialog", { name: "Predict, then run", exact: true });
  const submit = () => dialog().getByRole("button", { name: "Lock prediction and run", exact: true });
  const start = async () => {
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url() === `${api}/challenges/${lab.lessonId}/attempts` && r.request().method() === "POST"),
      submit().click(),
    ]);
    if (response.status() !== 201) throw new Error(`Real attempt start returned ${response.status()}`);
    const run = (await response.json()).createdDeployment;
    if (!run?.id) throw new Error("Real start did not return a run id");
    return run.id;
  };
  try {
    // Unlike legacy steps, failure steps stop at their first failed assertion.
    await step(`failure: ${entry.id}`, async () => {
      if (entry.flow === "list" || entry.flow === "lesson") {
        await page.goto(`${web}${entry.flow === "list" ? "/learn" : lessonPath(lesson)}`, { waitUntil: "load" });
        await waitVisible(page.getByRole("alert").filter({ hasText: entry.alert }));
        if (entry.flow === "lesson") await waitVisible(page.getByRole("heading", { level: 1, name: "Lesson unavailable", exact: true }));
        await page.screenshot({ path: `${shots}/${entry.id}-failure.png`, fullPage: true });
        await retry();
        if (entry.flow === "list") await waitVisible(page.getByRole("link", { name: lesson.title, exact: true }));
        else await waitVisible(page.getByRole("heading", { level: 1, name: lesson.title, exact: true }));
      } else if (entry.flow === "check-session") {
        // Checks never POST answers. A 401 can only be observed on the next server request.
        await showLesson();
        for (const prerequisite of lesson.prerequisites) await waitVisible(page.getByRole("complementary", { name: "Suggested prerequisites", exact: true }).getByRole("link", { name: prerequisite.title, exact: true }));
        injection.arm();
        const answer = page.getByRole("group", { name: lesson.check.question, exact: true }).getByRole("radio", { name: lesson.check.correct, exact: true });
        await answer.check(); await requireChecked(answer, "Device-local answer");
        await waitVisible(page.getByText(SAVED_LESSON_NOTE, { exact: true }));
        if (injection.injected.length) throw new Error("A local check unexpectedly requested the catalogue");
        await page.goto(`${web}/learn`, { waitUntil: "load" });
        await page.waitForURL(`${web}/signin`); injection.assertInjected(); injection.release();
        await page.screenshot({ path: `${shots}/${entry.id}-failure.png`, fullPage: true });
        await signIn(); await showLesson();
        await requireChecked(page.getByRole("group", { name: lesson.check.question, exact: true }).getByRole("radio", { name: lesson.check.correct, exact: true }), "Answer after sign-in");
        await waitVisible(page.getByText(SAVED_LESSON_NOTE, { exact: true }));
      } else {
        await page.goto(`${web}/learn/lessons/${lab.lessonId}`, { waitUntil: "load" });
        await page.getByRole("button", { name: "Open challenge lab", exact: true }).click();
        await page.waitForURL(/\/design\?design=/, { timeout: 60_000 });
        await page.getByRole("button", { name: "Predict and run", exact: true }).click();
        await waitVisible(dialog());
        await answerJourneyPredictions(dialog(), lab);
        const reasoning = "Local failure journey: keep this prediction while the request fails.";
        await dialog().getByRole("textbox", { name: "Why do you expect this?" }).fill(reasoning);
        if (entry.flow === "start" || entry.flow === "start-session") {
          await submit().click();
          if (entry.flow === "start-session") {
            await page.waitForURL(`${web}/signin`); injection.assertInjected(); injection.release();
            await page.screenshot({ path: `${shots}/${entry.id}-failure.png`, fullPage: true });
            await signIn();
            await page.goto(`${web}/learn/lessons/${lab.lessonId}`, { waitUntil: "load" });
            await waitVisible(page.getByText("No recorded attempt is linked here. No outcome is claimed.", { exact: true }));
          } else {
            await waitVisible(dialog().getByRole("alert").filter({ hasText: entry.message }));
            injection.assertInjected();
            if (await page.getByText("Prediction locked. The attempt is starting.", { exact: true }).count()
              || await page.getByRole("link", { name: "See the result", exact: true }).count()) throw new Error("A refused start claimed success");
            if (await dialog().getByRole("textbox", { name: "Why do you expect this?" }).inputValue() !== reasoning) throw new Error("Failure lost prediction reasoning");
            await requireChecked(dialog().getByRole("radio").first(), "Prediction after refusal");
            await waitVisible(dialog().getByRole("link", { name: "Check Runs before trying again", exact: true }));
            if (!await submit().isEnabled()) throw new Error("Refusal offered no retry");
            await page.screenshot({ path: `${shots}/${entry.id}-failure.png`, fullPage: true });
            await dialog().getByRole("button", { name: "Keep designing", exact: true }).click();
            await page.goto(`${web}/learn/lessons/${lab.lessonId}`, { waitUntil: "load" });
            await waitVisible(page.getByText("No recorded attempt is linked here. No outcome is claimed.", { exact: true }));
          }
        } else {
          const workerReady = page.waitForResponse(r => r.url().startsWith(`${api}/deployments/`) && r.url().endsWith("/browser-run") && r.request().method() === "GET" && r.ok(), { timeout: 120_000 });
          // Keep the pending observation handled if the start fails first; its
          // rejection is still asserted below whenever start succeeds.
          void workerReady.catch(() => {});
          const runId = await start();
          if (entry.flow === "browser-input") {
            await waitVisible(page.getByText(entry.alert, { exact: true }));
            await waitVisible(page.getByText(`${entry.message} This page keeps trying.`, { exact: true }));
            await page.screenshot({ path: `${shots}/${entry.id}-failure.png`, fullPage: true });
            injection.assertInjected(); injection.release();
          }
          if ((await workerReady).url() !== `${api}/deployments/${runId}/browser-run`) throw new Error("Browser input belongs to another run");
          await page.waitForFunction(() => {
            const clock = [...document.querySelectorAll("dt")].find(term => term.textContent === "Simulated")?.nextElementSibling?.textContent;
            return /^\d{2}:\d{2}$/.test(clock ?? "") && clock !== "00:00";
          }, null, { timeout: 60_000 });
          await page.getByRole("radiogroup", { name: "Simulation speed", exact: true }).getByRole("radio", { name: "Pause", exact: true }).click({ timeout: 60_000 });
          await waitVisible(page.getByRole("status").filter({ hasText: /^Simulation paused$/ }));
          if (entry.flow === "reload") {
            await page.reload({ waitUntil: "load" });
            await page.goto(`${web}/home`, { waitUntil: "load" });
            await waitVisible(page.getByText(/nothing is running and nothing was saved\. Start it again from the beginning/));
            await waitVisible(page.getByRole("button", { name: "Start it again", exact: true }));
            await page.screenshot({ path: `${shots}/${entry.id}-failure.png`, fullPage: true });
            const cancelled = page.waitForResponse(r => r.url() === `${api}/deployments/${runId}/cancel` && r.request().method() === "POST");
            await page.getByRole("button", { name: "Discard this run", exact: true }).click();
            if (!(await cancelled).ok()) throw new Error("Lost browser run could not be discarded");
          } else {
            // Let the real worker finish quickly; no outcomes or evidence are fabricated.
            await page.getByRole("radiogroup", { name: "Simulation speed", exact: true }).getByRole("radio", { name: "60×", exact: true }).click();
            if (entry.flow === "delivery") {
              await page.getByRole("alert").filter({ hasText: entry.alert }).waitFor({ state: "visible", timeout: 150_000 });
              await waitVisible(page.getByText(/Server receipt and verification have not been confirmed\./));
              if (injection.injected.length !== entry.attempts) throw new Error(`Expected ${entry.attempts} busy delivery attempts, saw ${injection.injected.length}`);
              await waitVisible(page.getByText(/The server is busy replaying other runs\./));
              await page.screenshot({ path: `${shots}/${entry.id}-failure.png`, fullPage: true });
              injection.assertInjected(); injection.release();
              await page.getByRole("button", { name: "Send again", exact: true }).click();
            }
            const result = page.getByRole("link", { name: "See the result", exact: true });
            await result.waitFor({ state: "visible", timeout: 240_000 });
            if (await result.getAttribute("href") !== `/runs/${runId}`) throw new Error("Recovery points to another run");
            await result.click();
            await page.waitForURL(`${web}/runs/${runId}`);
            const record = page.locator("details").filter({ has: page.locator("summary", { hasText: "Full evidence record" }) });
            await record.locator("summary").first().click(); // The opened record holds nested summaries; the first one is the record's own.
            await waitVisible(record.getByRole("heading", { name: "Prediction against the record", exact: true }));
          }
        }
      }
      if (entry.path) injection.assertInjected();
      await page.screenshot({ path: `${shots}/${entry.id}-recovered.png`, fullPage: true });
      return { case: entry.id, injected: injection.injected.length, recovery: entry.recovery };
    });
  } finally { await injection.dispose(); }
}

async function runJourney() {
  const selection = selectJourney(process.env);
  const lab = selection.kind === "lab" ? selection.entry : null;

  const WEB = process.env.JOURNEY_WEB ?? "http://localhost:5173";
  if (!/^http:\/\/localhost:\d+$/.test(WEB)) { console.error("journey only runs against a localhost dev stack"); process.exit(2); }
  const failureApi = selection.kind === "failure" ? localFailureApi(process.env.JOURNEY_API) : null;
  const { chromium } = createRequire(process.env.PW_DIR ? `${process.env.PW_DIR}/package.json` : `${process.cwd()}/package.json`)("playwright-core");
  const SHOTS = process.env.JOURNEY_SHOTS ?? `${process.cwd()}/learn-shots`; mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Block remote requests even if a local page redirects or references a remote asset.
  await context.route("**/*", (route) => isLocalJourneyRequest(route.request().url()) ? route.continue() : route.abort("blockedbyclient"));
  const page = await context.newPage();
  const injections = [];
  const expectedFailures = [];
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror ${page.url()} ${e.message.slice(0, 160)}`));
  // This script aborts every non-local request on purpose, so those aborts are reported separately and never fail a journey.
  const blockedRemote = [];
  page.on("console", (m) => { if (m.type() !== "error") return; const line = `console ${page.url()} ${m.text().slice(0, 160)}`; if (selection.kind === "failure" && injections.some(i => i.expectedConsole(m))) { expectedFailures.push(line); return; } (/ERR_BLOCKED_BY_CLIENT/.test(line) ? blockedRemote : problems).push(line); });
  page.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) { const line = `HTTP ${r.status()} ${r.url().replace(WEB, "")}`; if (selection.kind === "failure" && injections.some(i => i.expectedResponse(r))) expectedFailures.push(line); else problems.push(line); } });

  const results = [];
  async function step(name, fn) {
    const t = Date.now();
    try { const detail = await fn(); results.push({ name, ok: true, ms: Date.now() - t, ...(detail ? { detail } : {}) }); }
    catch (e) {
      results.push({ name, ok: false, ms: Date.now() - t, error: String(e.message ?? e).split("\n")[0].slice(0, 300) });
      await page.screenshot({ path: `${SHOTS}/FAIL-${results.length}-${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
    }
  }
  const text = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
  const id = randomBytes(4).toString("hex"), password = `Aa1!${randomBytes(12).toString("base64url")}x9`;

  await step("sign up a disposable account", async () => {
    await page.goto(`${WEB}/signup`, { waitUntil: "load", timeout: 90_000 });
    await page.locator('input[name="username"]').waitFor({ timeout: 90_000 });
    const email = page.locator("#signup-email-direct"); if (await email.count()) await email.fill(`journey-${id}@example.test`);
    await page.locator('input[name="username"]').fill(`journey${id}`);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('form button[type="submit"]').last().click();
    await page.waitForURL(/\/home/, { timeout: 60_000 });
    return page.url().replace(WEB, "");
  });
  if (selection.kind === "failure") {
    try {
      if (results.some(r => !r.ok)) throw new Error("Disposable signup failed; no failure journey was exercised");
      await walkJourneyFailure(page, selection.entry, { web: WEB, api: failureApi, shots: SHOTS,
        observe: injection => injections.push(injection),
        step: async (name, fn) => { await step(name, fn); if (!results.at(-1).ok) throw new Error(results.at(-1).error); },
        signIn: async () => {
          await page.getByRole("textbox", { name: "Username or email", exact: true }).fill(`journey${id}`);
          await page.getByLabel("Password", { exact: true }).fill(password);
          await page.getByRole("button", { name: "Sign in", exact: true }).click();
          await page.waitForURL(`${WEB}/home`, { timeout: 60_000 });
        },
      });
    } catch (error) {
      if (!results.some(r => !r.ok)) results.push({ name: "failure journey setup", ok: false, error: String(error.message) });
    } finally {
      console.log(JSON.stringify({ web: WEB, failure: selection.entry.id, results,
        passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length,
        injectedRequests: injections.flatMap(i => i.injected), expectedFailures: [...new Set(expectedFailures)],
        blockedRemote: [...new Set(blockedRemote)].length, problems: [...new Set(problems)] }, null, 1));
      if (results.some(r => !r.ok) || problems.length) process.exitCode = 1;
      await browser.close();
    }
    return;
  }
  await step("home loads and offers a way into learning", async () => {
    await page.waitForLoadState("networkidle").catch(() => {});
    const body = await text();
    return { continueLearning: /continue learning|start learning|learning/i.test(body), learningLink: await page.locator('a[href="/learn"]').count() };
  });
  await step("learning page lists tracks and lessons from the server", async () => {
    await page.goto(`${WEB}/learn`, { waitUntil: "load" });
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => /\d+ lessons? found/.test(document.body.innerText), null, { timeout: 30_000 });
    const body = await text();
    await page.screenshot({ path: `${SHOTS}/1-learning.png`, fullPage: true });
    return { found: /(\d+) lessons? found/.exec(body)?.[1], mentionsRunnableLab: /runnable lab/i.test(body), tracksSeen: ["Foundations", "Scaling", "Databases", "Asynchronous", "Failures", "Missions"].filter((t) => body.includes(t)) };
  });
  if (selection.kind === "lesson") {
    await walkJourneyLesson(page, selection.entry, { web: WEB, shots: SHOTS, step });
  } else {
  await step("a reading lesson renders its sections and never claims a simulated result", async () => {
    await page.goto(`${WEB}/learn/lessons/what-is-a-request`, { waitUntil: "load" });
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 });
    const body = await text();
    await page.screenshot({ path: `${SHOTS}/2-reading.png`, fullPage: true });
    if (/requirements? met|recorded run showed/i.test(body)) throw new Error("reading lesson talks about run results");
    return { headings: await page.getByRole("heading").allInnerTexts(), hasLimits: /limit/i.test(body) };
  });
  await step("a concept check answers immediately and the answer is remembered on this device", async () => {
    await page.goto(`${WEB}/learn/lessons/client-and-server`, { waitUntil: "load" });
    const radios = page.getByRole("radio");
    await radios.first().waitFor({ timeout: 30_000 });
    await radios.first().check();
    await page.getByRole("status").filter({ hasText: /match|explanation|Review/i }).first().waitFor({ timeout: 10_000 });
    await page.reload({ waitUntil: "load" });
    await page.getByRole("radio").first().waitFor({ timeout: 30_000 });
    return { restoredAfterReload: await page.getByRole("radio").first().isChecked() };
  });
  await step("a runnable lab lesson offers its pinned challenge and says no result is known yet", async () => {
    await page.goto(`${WEB}/learn/lessons/${lab.lessonId}`, { waitUntil: "load" });
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 });
    const body = await text();
    await page.screenshot({ path: `${SHOTS}/3-lab.png`, fullPage: true });
    if (!(await page.getByRole("button", { name: /open challenge lab/i }).count())) throw new Error("no Open challenge lab control");
    return { noClaimBeforeRun: /No recorded attempt is linked here\. No outcome is claimed/.test(body), mentionsPrediction: /predict/i.test(body) };
  });
  await step("the lesson opens the real challenge workspace with its starter, requirements and a prediction gate", async () => {
    await page.getByRole("button", { name: /open challenge lab/i }).click();
    await page.waitForURL(/\/design\?design=/, { timeout: 60_000 });
    await page.getByRole("button", { name: /predict and run/i }).waitFor({ timeout: 60_000 });
    const body = await text();
    await page.screenshot({ path: `${SHOTS}/4-workspace.png` });
    return { url: page.url().replace(WEB, "").replace(/design=.*/, "design=<id>"), title: lab.title.test(body), brief: /Fixed conditions/.test(body), requirements: /Checked during the run/.test(body), predictionGate: /commit to one prediction first/i.test(body) };
  });
  await step("Predict and run asks for the prediction before any run starts", async () => {
    await page.getByRole("button", { name: /predict and run/i }).click();
    const dialog = page.getByRole("dialog").first();
    await dialog.waitFor({ timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/5-prediction.png` });
    return { dialogText: (await dialog.innerText()).replace(/\s+/g, " ").slice(0, 700), buttons: await dialog.getByRole("button").allInnerTexts(), radios: await dialog.getByRole("radio").count(), selects: await dialog.locator("select").count() };
  });
  await step("a prediction is locked and the real browser run starts and stops at its evaluation second", async () => {
    const dialog = page.getByRole("dialog").first();
    await answerJourneyPredictions(dialog, lab);
    await dialog.getByRole("textbox").first().fill(lab.prediction).catch(() => {});
    await dialog.getByRole("button", { name: /lock prediction and run/i }).click();
    await page.screenshot({ path: `${SHOTS}/6-running.png` });
    // Each challenge supplies its evaluation second; wait for the app to show a finished attempt.
    await page.getByRole("link", { name: /see the result/i }).waitFor({ timeout: 240_000 });
    await page.screenshot({ path: `${SHOTS}/7a-finished.png` });
    await page.getByRole("link", { name: /see the result/i }).click();
    await page.waitForURL(/\/runs\//, { timeout: 120_000 });
    await page.waitForFunction(() => /Your prediction/.test(document.body.innerText) && /requirements? met/.test(document.body.innerText), null, { timeout: 120_000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SHOTS}/7-after-run.png` });
    const body = await text();
    return { url: page.url().replace(WEB, "").replace(/(design|run)[=/][^&]*/g, "$1=<id>"), debrief: body.slice(body.indexOf("Challenge result")).slice(0, 1500), buttons: await page.getByRole("button").allInnerTexts(), links: (await page.getByRole("link").allInnerTexts()).slice(0, 14) };
  });
  await step("the recorded result page shows the challenge verdict, the prediction against the record and a way back to the lesson", async () => {
    await page.waitForURL(/\/runs\//, { timeout: 60_000 }).catch(() => {});
    const body = await text();
    await page.screenshot({ path: `${SHOTS}/8-result.png`, fullPage: true });
    await page.getByText(lab.expected.starter, { exact: true }).first().waitFor({ timeout: 30_000 });
    const requirements = await inspectJourneyRequirements(page, lab);
    if (lab.reportRequirements) await page.screenshot({ path: `${SHOTS}/8-budget-requirement.png`, fullPage: true });
    return { url: page.url().replace(WEB, "").replace(/runs\/.*/, "runs/<id>"), verdict: /(\d+ of \d+ requirements? met at \d+s)/.exec(body)?.[1] ?? null, notMetOrMet: /Not met|Met/.exec(body)?.[0] ?? null, predictionComparison: /Your prediction/.test(body) && /recorded/.test(body), partOfLesson: /Part of lesson/.test(body), debrief: body.slice(Math.max(0, body.indexOf("Your design"))).slice(0, 900), ...(lab.reportRequirements ? { requirements } : {}) };
  });
  await step("the lesson now shows the learner's own recorded attempt from the server", async () => {
    await page.goto(`${WEB}/learn/lessons/${lab.lessonId}`, { waitUntil: "load" });
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => /Server activity:/.test(document.body.innerText) && !/No recorded attempts/.test(document.body.innerText), null, { timeout: 30_000 });
    const body = await text();
    await page.screenshot({ path: `${SHOTS}/9-lesson-after.png`, fullPage: true });
    return { activity: /Server activity: ([^·]*)/.exec(body)?.[1]?.trim(), whatRunShowed: body.slice(Math.max(0, body.search(/latest (recorded )?attempt|What (did )?your run/i))).slice(0, 700) };
  });
  await step("one change is planned with a written hypothesis and the earlier design reopens", async () => {
    await page.goto(`${WEB}/learn/lessons/${lab.lessonId}`, { waitUntil: "load" });
    await page.getByRole("link", { name: /inspect the latest recorded attempt/i }).first().click();
    await page.waitForURL(/\/runs\//, { timeout: 30_000 });
    // The button stays disabled until the server's guided review of this run has loaded; wait for it, retry if the dialog closes on a re-render.
    const plan = page.getByRole("button", { name: /plan one change/i });
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /plan one change/i.test(b.textContent ?? "") && !b.disabled), null, { timeout: 120_000 });
    for (let attempt = 0; attempt < 4 && !(await page.locator("textarea").count()); attempt++) { await plan.click(); await page.waitForTimeout(1500); }
    await page.locator("textarea").first().waitFor({ timeout: 30_000 });
    await page.locator("textarea").first().fill(lab.hypothesis);
    await page.screenshot({ path: `${SHOTS}/10-plan-change.png` });
    await page.locator('button[form="learning-plan"]').click();
    await page.waitForURL(/\/design/, { timeout: 60_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.screenshot({ path: `${SHOTS}/11-improvement-design.png` });
    return { url: page.url().replace(WEB, "").replace(/design=.*/, "design=<id>"), hasHypothesisNotice: /hypothesis|one change|improvement/i.test(await text()) };
  });
  await step(lab.improvement.stepName, async () => {
    const chosen = await applyJourneyImprovement(page, lab.improvement);
    await page.screenshot({ path: `${SHOTS}/12-size-changed.png` });
    return { chosen, resources: /(\d+) resources/.exec(await text())?.[1] };
  });
  await step("the improved design runs through the same prediction gate and its recorded result is shown", async () => {
    await page.getByRole("button", { name: /predict and run/i }).click();
    const dialog = page.getByRole("dialog").first();
    await dialog.waitFor({ timeout: 30_000 });
    await answerJourneyPredictions(dialog, lab);
    await acknowledgeJourneyChanges(dialog, lab.improvement);
    await dialog.getByRole("button", { name: /lock prediction and run/i }).click();
    await page.getByRole("link", { name: /see the result/i }).waitFor({ timeout: 240_000 });
    await page.getByRole("link", { name: /see the result/i }).click();
    await page.waitForURL(/\/runs\//, { timeout: 120_000 });
    await page.waitForFunction(() => /Your design/.test(document.body.innerText) && /requirements? met/.test(document.body.innerText), null, { timeout: 120_000 });
    const body = await text();
    await page.screenshot({ path: `${SHOTS}/13-improved-result.png`, fullPage: true });
    await page.getByText(lab.expected.improved, { exact: true }).first().waitFor({ timeout: 30_000 });
    const requirements = await inspectJourneyRequirements(page, lab);
    if (lab.reportRequirements) await page.screenshot({ path: `${SHOTS}/13-budget-requirement.png`, fullPage: true });
    return { verdict: /(\d+ of \d+ requirements? met at \d+s)/.exec(body)?.[1], whatChanged: body.slice(Math.max(0, body.search(/change|hypothesis|compared|same conditions/i))).slice(0, 700), ...(lab.reportRequirements ? { requirements } : {}) };
  });
  await step("the two runs can be compared and the comparison states its conditions", async () => {
    const improved = page.getByRole("link", { name: /compare with the attempt you improved/i });
    if (await improved.count()) await improved.first().click(); else await page.getByRole("link", { name: /compare with/i }).first().click();
    await page.waitForURL(/\/runs\/compare/, { timeout: 60_000 });
    await page.getByRole("heading", { level: 1, name: /compare two runs/i }).waitFor({ timeout: 90_000 });
    await page.waitForFunction(() => /Challenge conditions|One simulation-relevant design change|design change/i.test(document.body.innerText), null, { timeout: 90_000 });
    const body = await text();
    await page.screenshot({ path: `${SHOTS}/14-compare.png`, fullPage: true });
    return { verdictAndConditions: body.slice(body.indexOf("Compare two runs")).slice(0, 1500) };
  });
  await step("the lesson shows the factual progress after the improvement", async () => {
    await page.goto(`${WEB}/learn/lessons/${lab.lessonId}`, { waitUntil: "load" });
    await page.waitForFunction(() => /Server activity:/.test(document.body.innerText), null, { timeout: 30_000 });
    const body = await text();
    await page.screenshot({ path: `${SHOTS}/15-lesson-final.png`, fullPage: true });
    return { activity: /Server activity: ([^·]*?)(?= Prerequisites| Problem)/.exec(body)?.[1]?.trim(), attempts: /(\d+) (recorded )?attempts?/i.exec(body)?.[0] ?? null };
  });
  await step("keyboard: lesson page can be operated with Tab only", async () => {
    await page.goto(`${WEB}/learn/lessons/client-and-server`, { waitUntil: "load" });
    await page.getByRole("radio").first().waitFor({ timeout: 30_000 });
    const focusable = [];
    for (let i = 0; i < 25; i++) { await page.keyboard.press("Tab"); focusable.push(await page.evaluate(() => document.activeElement?.tagName + ":" + (document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").trim().slice(0, 30))); }
    return { reached: [...new Set(focusable)].slice(0, 12) };
  });

  }
  console.log(JSON.stringify({ web: WEB, results, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, blockedRemote: [...new Set(blockedRemote)].length, problems: [...new Set(problems)].slice(0, 12) }, null, 1));
  if (results.some((r) => !r.ok) || (selection.kind === "lesson" && problems.length)) process.exitCode = 1;
  await browser.close();
}

// Importing the table for unit tests must not load Playwright, create accounts or launch a browser.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runJourney();
