import type { Quantity } from "../../reality/quantity";
import type { ComputeResource } from "../compute/contracts";
export interface SchedulerConfig {
  id: string;
  kind: "scheduler";
  profile: "bounded-simulated-triggers/1";
  execution: ComputeResource;
  target: string;
  operation: "read" | "write";
  start: Quantity<"us">;
  period: Quantity<"us">;
  maxTriggers: Quantity<"count">;
  overlap: "skip" | "allow" | "queue";
  maxConcurrent: Quantity<"count">;
  queueCapacity: Quantity<"count">;
  maxAttempts: Quantity<"count">;
  retryDelay: Quantity<"us">;
  timeout: Quantity<"us">;
  maxLateness: Quantity<"us">;
  missed: "skip" | "latest";
}
