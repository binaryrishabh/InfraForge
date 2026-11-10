import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import { serverlessError } from "@infraforge/domain/resource";
import { ServerlessMetricsSchema } from "../reports/serverlessSchema";
import type { Topology } from "./criteria";

type Criterion = Extract<ChallengeCriterion, {kind: "function-reuse"}>;
const count = (n: number) => Number.isSafeInteger(n) && n >= 0;
export const functionReuseLimits = (c: Criterion) => count(c.minCompleted) && c.minCompleted > 0 && count(c.maxColdStarts) && count(c.maxUnsuccessful);

/** Cumulative invocation outcomes, never a latency or provider warm-retention promise. */
export function evaluateFunctionReuse(c: Criterion, input: Topology | null, terminal: ReportCheckpoint | null, second: number) {
  const sources = ["runInputs.resources.serverless", "terminalSnapshot.metrics.serverless", "terminalSnapshot.simulatedSeconds"];
  const unknown = (detail: string) => ({met: undefined, detail, sources});
  if (!functionReuseLimits(c) || !input || !terminal || terminal.simulatedSeconds !== second || terminal.measurementFreshness !== "current-revision") return unknown("A captured design and current function evidence at the exact evaluation second are required.");
  const owners = input.resources.filter(r => r.id === c.resourceId), owner = owners[0];
  if (owners.length !== 1 || owner?.type !== "Serverless Function" || serverlessError(owner.type, owner.serverless)) return unknown("The named function and valid saved lifecycle settings must be retained.");
  const rows = terminal.resources.filter(r => r.id === c.resourceId), parsed = ServerlessMetricsSchema.safeParse(rows[0]?.serverless);
  if (rows.length !== 1 || !parsed.success || !parsed.data.lifecycle) return unknown("Complete, consistent function outcomes and elapsed lifecycle evidence were not recorded; missing values stay Unknown.");
  const f = parsed.data, unsuccessful = f.failed + f.timedOut + f.cancelled + f.throttled + f.unavailable + f.duplicate;
  return {met: f.completed >= c.minCompleted && f.coldStarts <= c.maxColdStarts && unsuccessful <= c.maxUnsuccessful, sources,
    detail: `Through second ${second}, ${c.resourceId}: ${f.completed} completed (minimum ${c.minCompleted}), ${f.coldStarts} cold starts (maximum ${c.maxColdStarts}), ${unsuccessful} unsuccessful invocations (maximum ${c.maxUnsuccessful}); ${f.warmStarts} warm starts, ${f.expired} idle expiries, ${f.active} active. Recorded initialization time ${f.lifecycle!.initializationUs} us includes active work. This is a cumulative reuse budget, not a latency SLO or provider retention guarantee.`};
}
