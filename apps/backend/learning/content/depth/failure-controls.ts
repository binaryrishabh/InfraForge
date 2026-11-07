import { circuitBreakerBoundariesV2 } from "./lessons/circuit-breaker-boundaries-v2";
import type { LearningModule } from "@infraforge/contracts/learning";
import { concurrentCacheMisses } from "./lessons/concurrent-cache-misses";
import { shareACacheFill } from "./lessons/share-a-cache-fill";
import { circuitBreakerBoundaries } from "./lessons/circuit-breaker-boundaries";
import { poolIsolationBoundaries } from "./lessons/pool-isolation-boundaries";
import { timeoutOwnership } from "./lessons/timeout-ownership";
import { retryLimitsAndBudgets } from "./lessons/retry-limits-and-budgets";
import { backpressureBoundaries } from "./lessons/backpressure-boundaries";

export const failureControlLessons = [concurrentCacheMisses, backpressureBoundaries, retryLimitsAndBudgets,
  circuitBreakerBoundariesV2, poolIsolationBoundaries, timeoutOwnership, shareACacheFill];
export const failureControls: LearningModule = {
  id: "failure-controls", availability: "available", title: "Bound work and name the missing proof",
  summary: "Practice single-flight, then distinguish retry budgets, circuit admission, pool isolation, timeout ownership and feedback limits.",
  lessonIds: failureControlLessons.map(l => l.id),
};

export const failureControlArchivedLessons = [circuitBreakerBoundaries];
