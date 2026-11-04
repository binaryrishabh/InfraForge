import type { Quantity } from "../../reality/quantity";
import type { ComputeResource } from "../compute/contracts";
export interface ServerlessConfig {
  id: string;
  kind: "serverless";
  profile: "invocation-warm-reuse/1";
  execution: ComputeResource;
  concurrency: Quantity<"count">;
  initialization: Quantity<"us">;
  duration: Quantity<"us">;
  timeout: Quantity<"us">;
  idleExpiry: Quantity<"us">;
  failurePercent: Quantity<"percent">;
  database?: string;
}
