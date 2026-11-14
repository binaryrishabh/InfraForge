import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const orderTheRowLocksV1: ChallengeDefinition = {
  engine: "2", id: "order-the-row-locks", version: 1, title: "Order the row locks", difficulty: "advanced",
  summary: "A few transfers fail while neither the app nor the database is out of CPU. Find what two writes do to each other.",
  concepts: ["Row locks", "Deadlock", "Lock ordering", "Failures without a CPU limit"],
  story: ["A ledger service moves a balance between two accounts in one request: update the first row, then the second. Ten account rows take 500 transfers a second, arriving at random moments.",
    "The app and the database are each about three-quarters busy, not out of CPU, yet a few of every hundred transfers fail. Compare the failed callers with the deadlocks the database detected."],
  objective: "Through second 30, complete at least 14000 transfers with none unsuccessful and have no deadlocks. Test one database setting.",
  workload: {targetThroughput: 30000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0, payloadSize: "light", workloadDynamics: {version: 1, arrivalProcess: "poisson", applicationCpuCv: 0}},
  workloadNote: "500 transfers/s at random (Poisson) times, every one a two-row write over 10 modeled rows. Each transfer is one transaction.",
  evaluationSeconds: 30, evaluationNote: "Cumulative caller outcomes and database lock counters through second 30.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "callers", kind: "caller-outcomes", label: "Complete 14000 transfers with none unsuccessful through second 30", minCompleted: 14000, maxUnsuccessful: 0},
    {id: "deadlocks", kind: "database-deadlocks", label: "Have no deadlocks through second 30", resourceId: "db", maxDeadlocks: 0}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will the starter record at second 30? Do app and database CPU explain the failed transfers?"}],
  hints: ["Open the database's readings beside the failed callers. Failures while CPU is not exhausted point at waiting, not at capacity.",
    "A bigger app changes almost nothing, and a bigger database only lets transfers finish sooner, so locks are held for less time: two transfers that name the same two rows in opposite order can still wait for each other, and more rows only make that meeting rarer.",
    "Select db. Set Row lock order to Two rows, by key and change nothing else. Keep the rows, workload and connections unchanged."],
  debrief: ["With the order as requested, one transfer can hold row A and wait for row B while another holds B and waits for A. Neither can finish, so the database ends one of them as the deadlock victim and that caller sees a failure. Setting the order to by key makes every transfer take the lower-numbered row first, so a cycle cannot form: transfers still wait for each other, but never in a circle.",
    "As a near miss, restore the setting and make the database bigger: CPU was never the limit, so it roughly halves the failures but does not remove them. A bigger app barely changes anything. Spreading the same transfers over many more rows lowers the odds a lot (forty rows leave about twenty failures in this run, four hundred leave one or none), and that is a valid way to make a run clean, but it only makes a cycle unlikely, not impossible. Switching the setting off removes the two-row write altogether, so there is nothing left to measure and the deadlock requirement stays not evaluated.",
    "This models the order in which a transaction touches rows, as an educational model. It says nothing about how any particular database product times, detects or resolves deadlocks: here a cycle is found immediately and the requesting transaction is the victim. Not verified: retries after a deadlock, longer transactions, or other lock modes.",
    MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0, {skuId: "c5.xlarge"}],
    ["db", "Database", 1, 0, {size: "medium", dataKeyspace: {version: 1, count: 10, accessPattern: "uniform"}, rowLocking: {version: 1, rowsPerWrite: 2, order: "as-requested"}}]],
  [["app", "db"]]),
};
