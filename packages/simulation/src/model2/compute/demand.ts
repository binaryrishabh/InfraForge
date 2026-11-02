import { keyedUniform } from "../random";

export const APP_CPU_DISTRIBUTION = "app-cpu-demand/1: demand = mean * ((1 - cv) + cv * E); E = -ln(1 - min(u, 1 - 2^-20)); u = keyedUniform(seed, resourceId, identity(callId, computeStage), app-cpu-demand); round to whole microseconds, minimum 1; cv 0 returns exact mean without a draw; clamped E <= 20*ln(2); clamp changes mean by less than 1e-5 relative before rounding; ideal CV = cv";
export interface AppCpuDistribution { schema: "app-cpu-demand/1"; cv: number; provenance: string }

export function sampleAppCpu(mean: number, distribution: Pick<AppCpuDistribution, "schema" | "cv"> | undefined,
  seed: string, resourceId: string, callId: string, computeStage: string): number {
  if (!distribution || distribution.cv === 0) return mean;
  const { cv } = distribution;
  if (distribution.schema !== "app-cpu-demand/1" || !Number.isFinite(cv) || cv < 0 || cv > 1 || !seed || !Number.isFinite(mean) || mean < 0) throw Error("Invalid application CPU distribution/seed/mean");
  const u = Math.min(keyedUniform(seed, resourceId, JSON.stringify([callId, computeStage]), "app-cpu-demand"), 1 - 2 ** -20);
  const demand = Math.max(1, Math.round(mean * ((1 - cv) + cv * -Math.log1p(-u))));
  if (!Number.isSafeInteger(demand)) throw Error("Application CPU demand exceeds safe microsecond domain");
  return demand;
}
