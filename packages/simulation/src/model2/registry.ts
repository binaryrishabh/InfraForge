import { createInitialState, tick } from "../engine";
import { createWorkloadModel2 } from "./workload/run";

export const ACTIVE_MODEL_VERSION = "1" as const;
export function resolveModel(version: string, options: { internal?: boolean } = {}) {
  if (version === "1") return { version: "1" as const, published: true as const, createInitialState, tick };
  if (version === "2" && options.internal === true) return { version: "2" as const, workloadVersion: "m2b/1" as const, published: false as const, create: createWorkloadModel2 };
  if (version === "2") throw new Error("Model 2 is an internal foundation, not an active simulation model");
  throw new Error(`Unsupported simulation model: ${version}`);
}
