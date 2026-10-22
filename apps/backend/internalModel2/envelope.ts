import { z } from "zod";
import * as v1 from "./envelopeV1";
import * as v2 from "./envelopeV2";
export { CompilationRefusal } from "./envelopeV1";
export const admissionSchema = v1.admissionSchema.extend({ execution: z.literal("infraforge-internal-execution/2").optional(), causal: v2.causalLimits.optional() }).strict();
export type ExecutionEnvelope = v1.ExecutionEnvelope | v2.ExecutionEnvelopeV2;
export function compileEnvelope(run: string, owner: string, layout: unknown, updated: Date, request: z.infer<typeof admissionSchema>): ExecutionEnvelope {
  if (request.execution === "infraforge-internal-execution/2") {
    try { return v2.compileEnvelopeV2(run, owner, layout, updated, request); }
    catch (error) { if (error instanceof v1.CompilationRefusal) throw error; throw new v1.CompilationRefusal([{ code: "CONNECTED_CONTRACT", path: "contract", message: "The complete connected contract is invalid or exceeds persistence limits", severity: "error" }]); }
  }
  if (request.causal !== undefined) throw Error("Causal limits require execution v2");
  return v1.compileEnvelope(run, owner, layout, updated, request);
}
export function readEnvelope(value: unknown, expected: string, compatible = true): ExecutionEnvelope {
  switch ((value as { schema?: string })?.schema) {
    case "infraforge-internal-execution/1": return v1.readEnvelope(value, expected, compatible);
    case "infraforge-internal-execution/2": return v2.readEnvelopeV2(value, expected, compatible);
    default: throw Error("Unsupported historical input version; no reinterpretation");
  }
}
export const captureCuts = v1.captureCuts;
