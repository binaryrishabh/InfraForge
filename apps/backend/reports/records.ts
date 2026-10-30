import { z } from "zod";
import type { ReportCheckpoint, ReportStage } from "@infraforge/contracts/reports";
import { readRunInputs } from "../deployments/runInputs";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import { WorkloadProfileSchema } from "../zod_schemas/deployment.schema";
import { DeploymentChaosNames } from "@infraforge/domain/resource";

const text = z.string().min(1).max(4000);
const timestamp = z.iso.datetime({ offset: true });
const amount = z.number().finite().nonnegative();
const boundedId = z.string().min(1).max(256);
const boundedMap = <T>(schema: z.ZodType<T>) => z.record(boundedId, schema).refine((v) => Object.keys(v).length <= 500);
const pool = z.object({ lbId: boundedId, baseVmIds: z.array(boundedId).max(500), currentReplicas: amount.int(),
  minReplicas: amount.int(), maxReplicas: amount.int(), targetCpu: amount.max(100),
  pending: z.object({ action: z.enum(["up", "down"]), secondsRemaining: amount }).nullable() });
const event = z.object({ timestamp, event: text, message: text });
const chaos = z.object({ timestamp, type: text, resourceId: text, message: text });
const stage = z.object({ name: text, status: z.enum(["pending", "running", "completed", "failed"]),
  message: text, startedAt: timestamp, completedAt: timestamp, details: z.unknown().optional() });
// Model 2 records a value it does not model as null ("unknown"); reports treat it as not recorded, never as zero.
const health = z.enum(["healthy", "degraded", "saturated", "failed", "unknown"]);
const metrics = z.object({ cpu: amount.max(100).nullable().optional(), memory: amount.max(100).nullable().optional(),
  rps: amount.optional(), connections: amount.optional(), health: health.optional() });
const checkpoint = z.object({ simulatedSeconds: amount.optional(), loadFraction: amount.optional(),
  overallHealth: z.enum(["healthy", "degraded", "saturated", "critical"]).optional(), accumulatedCostUsd: amount.optional(),
  capturedAt: timestamp.optional(), topologyRevision: z.number().int().nonnegative().optional(), speed: amount.optional(),
  metricsComputedAt: timestamp.nullable().optional(), metricsTopologyRevision: z.number().int().nonnegative().optional(),
  burnRatePerHourUsd: amount.optional(), targetLoadFraction: amount.max(2).optional(),
  activeChaos: z.array(z.object({ chaosType: z.enum(DeploymentChaosNames).optional(),
    intervention: z.object({ actionId: boundedId, label: text,
      parameters: z.record(boundedId, z.union([z.number().finite(), z.boolean(), z.string().max(4000)])).refine(v => Object.keys(v).length <= 32),
      restoreAtUs: amount.int(), edgeIds: z.array(boundedId).max(2048).optional() }).optional(),
    resourceId: boundedId, durationTicks: amount.int(), remainingTicks: amount })).max(500).optional(),
  restarting: z.array(boundedId).max(500).optional(), pools: boundedMap(pool).optional(),
  installedSkus: boundedMap(boundedId).optional(),
  metrics: z.unknown().optional() });
const terminal = checkpoint.extend({ version: z.literal(1), kind: z.literal("terminal"), capturedAt: timestamp,
  topologyRevision: z.number().int().nonnegative(), simulatedSeconds: amount, accumulatedCostUsd: amount,
  overallHealth: z.enum(["healthy", "degraded", "saturated", "critical"]),
  metrics: boundedMap(metrics.extend({ cpu: amount.max(100).nullable(), memory: amount.max(100).nullable(), health })) });

export function readRecords(value: unknown, limits: string[]) {
  const list = <T>(input: unknown, schema: z.ZodType<T>, field: string): T[] => {
    if (!Array.isArray(input)) { limits.push(`${field} is malformed; no events were inferred from it.`); return []; }
    const valid: T[] = [];
    for (const item of input.slice(0, 500)) {
      const parsed = schema.safeParse(item);
      if (parsed.success) valid.push(parsed.data);
    }
    if (valid.length !== input.length) limits.push(`${field} contains invalid or additional records; only valid records from the first 500 entries are shown.`);
    return valid;
  };
  const row = value as { stages: unknown; timeline: unknown; chaosEvents: unknown; runInputs: unknown;
    liveTopology: unknown; workloadProfile: unknown; simulationState: unknown; terminalSnapshot?: unknown };
  let input: ReturnType<typeof readRunInputs> | null = null;
  if (row.runInputs != null) {
    try { input = readRunInputs(row.runInputs); }
    catch { limits.push("The original run input is malformed or unsupported; it was not reconstructed from the saved design."); }
  }
  const topology = LayoutSchema.safeExtend({ resources: LayoutSchema.shape.resources.unwrap(), connectionLines: LayoutSchema.shape.connectionLines.unwrap() });
  const live = row.liveTopology == null ? null : topology.safeParse(row.liveTopology);
  if (live && !live.success) limits.push("The accepted live topology is malformed and is not shown.");
  const workload = row.workloadProfile == null ? null : WorkloadProfileSchema.safeParse(row.workloadProfile);
  if (workload && !workload.success) limits.push("The legacy workload record is malformed and is not shown.");
  const stages: ReportStage[] = list(row.stages, stage, "Deployment stages").map((item) => {
    const details = z.object({ warnings: z.array(text).max(500).optional(), issues: z.array(text).max(500).optional(),
      monthlyEstimate: amount.optional() }).safeParse(item.details ?? {});
    if (!details.success) limits.push(`Some details for ${item.name} are malformed and are not shown.`);
    return { name: item.name, status: item.status, startedAt: item.startedAt, completedAt: item.completedAt,
      message: item.message, warnings: details.success ? details.data.warnings ?? [] : [],
      issues: details.success ? details.data.issues ?? [] : [],
      ...(details.success && item.name === "CostEstimate" && details.data.monthlyEstimate !== undefined
        ? { monthlyEstimateUsd: details.data.monthlyEstimate } : {}) };
  });
  return { input, live: live?.success ? live.data : null,
    legacyWorkload: workload?.success ? workload.data : null, stages,
    timeline: list(row.timeline, event, "Timeline"), chaos: list(row.chaosEvents, chaos, "Chaos events"),
    checkpoint: readCheckpoint(row.simulationState, limits), terminal: readTerminal(row.terminalSnapshot, limits) };
}

function readCheckpoint(value: unknown, limits: string[]): ReportCheckpoint | null {
  if (value == null) return null;
  const parsed = checkpoint.safeParse(value);
  if (!parsed.success) { limits.push("The retained checkpoint is malformed and is not shown."); return null; }
  const data = parsed.data;
  const resources: ReportCheckpoint["resources"] = [];
  if (data.metrics != null) {
    if (typeof data.metrics !== "object" || Array.isArray(data.metrics)) limits.push("Checkpoint resource measurements are malformed.");
    else {
      const entries = Object.entries(data.metrics);
      for (const [id, value] of entries.slice(0, 500)) {
        const item = metrics.safeParse(value);
        const known = item.success ? Object.fromEntries(Object.entries(item.data).filter(([, v]) => v !== null)) : {};
        if (item.success && Object.keys(item.data).length) resources.push({ id, ...known });
        else limits.push(`Checkpoint measurements for resource ${id} are malformed or empty.`);
      }
      if (entries.length > 500) limits.push("Only the first 500 checkpoint resources are shown.");
    }
  }
  if (!resources.length && data.simulatedSeconds === undefined && data.loadFraction === undefined &&
      data.overallHealth === undefined && data.accumulatedCostUsd === undefined) return null;
  return { resources, simulatedSeconds: data.simulatedSeconds, loadFraction: data.loadFraction,
    capturedAt: data.capturedAt, topologyRevision: data.topologyRevision, speed: data.speed,
    metricsComputedAt: data.metricsComputedAt, metricsTopologyRevision: data.metricsTopologyRevision,
    health: data.overallHealth, accumulatedCostUsd: data.accumulatedCostUsd,
    burnRatePerHourUsd: data.burnRatePerHourUsd, targetLoadFraction: data.targetLoadFraction,
    activeChaos: data.activeChaos, restarting: data.restarting, pools: data.pools, installedSkus: data.installedSkus,
    measurementFreshness: data.metricsComputedAt === null ? "initialized" :
      data.metricsTopologyRevision === undefined || data.topologyRevision === undefined || !data.metricsComputedAt ? "unknown" :
        data.metricsTopologyRevision !== data.topologyRevision ? "previous-revision" : "current-revision" };
}

function readTerminal(value: unknown, limits: string[]): ReportCheckpoint | null {
  if (value == null) return null;
  const parsed = terminal.safeParse(value);
  if (!parsed.success) { limits.push("The terminal record is malformed; no exact final-state claim is made from it."); return null; }
  return readCheckpoint(parsed.data, limits);
}
