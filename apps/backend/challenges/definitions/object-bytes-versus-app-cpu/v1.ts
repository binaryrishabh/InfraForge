import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const objectBytesVersusAppCpuV1: ChallengeDefinition = {
  engine: "2", id: "object-bytes-versus-app-cpu", version: 1, title: "Object bytes versus app CPU", difficulty: "core",
  summary: "Uploads fail at a stored-byte admission limit while the producer has spare CPU. Test which resource owns the constraint.",
  concepts: ["Object byte ownership", "Capacity admission", "Caller and background populations", "One-change experiments"],
  story: ["A producer uploads objects and publishes jobs. A worker reads uploads and writes results into the same store. The store starts with one seeded asset and a 1 MiB byte limit. The producer has spare CPU; each worker job has an authored 50 ms CPU demand.",
    "Run the unchanged design. The object's admission check computes the bytes that would be owned after a put, and refuses a put that would exceed capacity before committing it. Refused bytes are not owned. Successful upload-and-publish callers do not mean their background jobs have finished."],
  objective: "Complete at least 1100 callers with no unsuccessful callers through second 30. Change one setting and explain the owned-byte evidence beside CPU.",
  workload: {targetThroughput: 2400, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.8, payloadSize: "light"},
  workloadNote: "40 callers/s, steady, light payloads through the upload-and-publish helper. The nominal read ratio does not create synchronous database reads.",
  evaluationSeconds: 30, evaluationNote: "Caller counts cover run start through second 30. Stored bytes and CPU are samples; background work can remain at the boundary.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "caller-outcomes", label: "Complete at least 1100 callers; no unsuccessful callers", minCompleted: 1100, maxUnsuccessful: 0}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall modeled health will the unchanged run record in second 30?"}],
  hints: ["Compare Object stored bytes (current), Object capacity bytes (current), Puts reaching capacity check (cumulative), Object committed puts (cumulative), Object capacity refusals (cumulative), and producer CPU.",
    "A larger producer changes its CPU budget. It does not enlarge the store's owned-byte budget. More worker concurrency can write results sooner without creating storage space.",
    "Select store, open Object storage, and change only Stored data capacity (MiB) from 1 to 4. Keep producer size, worker settings and workload fixed."],
  debrief: ["The pair changes only the store's byte limit. In the starter, puts reach the capacity check but some do not commit. App CPU remains well below saturation. Enlarging only the producer lowers CPU utilization without changing the stored-byte limit or removing those refusals.",
    "Read puts, commits and command reasons as separate populations. Puts reaching capacity check excludes precondition failures and cancellations before application. An absent sparse capacity reason stays Unknown; equal puts and committed puts is positive evidence about these checked puts. Bounded current inventory cannot reconstruct all owned bytes by summing only visible rows.",
    "Whole run: Completed counts upload-and-publish callers. Acknowledged messages counts background jobs with completed receipts. The passing run still has ready and in-flight work; more accepted uploads can increase the backlog. This lab scores callers, not a drained queue.",
    "Extra bytes provide headroom for this fixed horizon, not sustainable storage under continuing unique uploads. This educational model has no real object-store API, physical durability or provider pricing. It proves no transaction across uploads, result writes and queue acknowledgement, no exactly-once business effect and no availability guarantee.", MODEL_NOTE],
  starter: starter([
    ["app", "Virtual Machine", 0, 0],
    ["queue", "Message Queue", 1, 0, {asyncQueue: {enabled: true, visibilityTimeoutSeconds: 30, maxReceives: 3, retentionSeconds: 300, deadLetterCapacity: 1000}}],
    ["worker", "Virtual Machine", 2, 0, {asyncWorker: {enabled: true, concurrency: 1, prefetch: 1, cpuMsPerJob: 50, badJobPercent: 0}}],
    ["store", "Object Storage", 1, 1, {objectStoragePolicy: {version: 1, capacityMiB: 1}}],
  ], [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]]),
};
