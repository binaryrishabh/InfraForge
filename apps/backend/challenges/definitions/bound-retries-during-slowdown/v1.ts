import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import type { Resource } from "@infraforge/domain/resource";

const apps: Resource[] = Array.from({length: 12}, (_, i) => ({id: `app${i}`, type: "Virtual Machine", x: 480, y: i * 240, size: "large"}));
const resources: Resource[] = [
  {id: "lb", type: "Load Balancer", x: 0, y: 0, retry: {enabled: true, maxAttempts: 5, backoffMs: 1, jitterRatio: 0.2, maxConcurrentRetries: 64,
    retryOn: ["backendFailure", "timeout", "connectionFailure"]}}, ...apps, {id: "db", type: "Database", x: 960, y: 0},
];
export const boundRetriesDuringSlowdownV1: ChallengeDefinition = {
  engine: "2", id: "bound-retries-during-slowdown", version: 1, title: "Retries during a DB slowdown", difficulty: "advanced",
  summary: "Keep the response-time tail bounded after a short database CPU slowdown.",
  concepts: ["Retry budgets", "Database contention", "Response time"],
  story: ["A read-only API retries failed and timed-out calls. During a database slowdown, those retries compete with fresh requests.",
    "At second 2, the scenario reduces db to 0.02 CPU cores for 2 seconds. The response-time tail is measured at second 5, after capacity returns."],
  objective: "Keep p95 response time at or below 1000 ms at second 5, with completed requests and a monthly design estimate within $2000.",
  workload: {targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "200 read-only requests per second, steady traffic with light payloads.", evaluationSeconds: 5,
  evaluationNote: "Scored at second 5. CPU capacity restores at 4,000,001 microseconds; end receipts must also be recorded.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete the deployment checks"},
    {id: "budget", kind: "monthly-budget", label: "Stay within $2000 a month", maxUsd: 2000},
    {id: "latency", kind: "terminal-p95", label: "Complete requests with p95 at most 1000 ms at second 5", maxMs: 1000}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What will overall health be at second 5?"}],
  hints: ["Inspect the load balancer's maximum attempts, retry backoff and concurrent retry budget.",
    "Try two attempts, 100 ms backoff and a budget of four concurrent retries. Keep jitter enabled."],
  debrief: ["A short database CPU slowdown can leave a response-time tail after capacity returns. Retries add work while the database is already busy.",
    "This exercise scores completed-request p95 after the slowdown. It does not claim that fewer retries always improve availability or total completions."],
  starter: {resources, connectionLines: apps.flatMap((app, i) => [
    {id: `lb-app${i}`, sourceId: "lb", targetId: app.id, sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80},
    {id: `app${i}-db`, sourceId: app.id, targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432},
  ])},
  scenario: {version: 1, visibility: "revealed", steps: [{id: "db-slowdown", atSecond: 2,
    request: {interventionId: "cpu-capacity", revision: 1, target: {resourceId: "db"}, parameters: {cores: 0.02, duration: 2}}}]},
};
