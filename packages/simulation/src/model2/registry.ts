import { createInitialState, tick } from "../engine";
import { createWorkloadModel2 } from "./workload/run";
import { createComputeModel2 } from "./compute/run";
import { createNetworkModel2 } from "./network/run";
import { createDataModel2 } from "./data/run";

export const ACTIVE_MODEL_VERSION = "1" as const;
export function resolveModel(version: string, options: { internal?: boolean; workloadVersion?: "m2b/1" | "m2c/1" | "m2d/1" | "m2e/1" } = {}) {
  if (version === "1") return { version: "1" as const, published: true as const, createInitialState, tick };
  if (version === "2" && options.internal === true) {
    if (options.workloadVersion === "m2e/1") return { version: "2" as const, workloadVersion: "m2e/1" as const, published: false as const, create: createDataModel2 };
    if (options.workloadVersion === "m2b/1") return { version: "2" as const, workloadVersion: "m2b/1" as const, published: false as const, create: createWorkloadModel2 };
    if (options.workloadVersion === "m2c/1") return { version: "2" as const, workloadVersion: "m2c/1" as const, published: false as const, create: createComputeModel2 };
    return { version: "2" as const, workloadVersion: "m2d/1" as const, published: false as const, create: createNetworkModel2 };
  }
  if (version === "2") throw new Error("Model 2 is an internal foundation, not an active simulation model");
  throw new Error(`Unsupported simulation model: ${version}`);
}
