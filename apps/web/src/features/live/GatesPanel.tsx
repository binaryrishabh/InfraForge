import { DEPLOYMENT_STAGES_NAMES, type Deployment, type DeploymentTimeline } from "@infraforge/contracts/deployment";
import { formatUsd } from "@/lib/format";
import { StatusMark } from "@/ui/StatusMark";
import type { StatusKind } from "@/ui/status";
import { STAGE_LABEL } from "@/features/reports/labels";


/* The three gates, as recorded: done, running, failed or not reached. */
export function GateList({ status, completed }: { status: string; completed: string[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {DEPLOYMENT_STAGES_NAMES.map((name, index) => {
        const done = completed.includes(name);
        const current = !done && completed.length === index;
        const kind: StatusKind = done ? "met" : current && status === "failed" ? "not-met" : current && ["pending", "running"].includes(status) ? "pending" : "not-started";
        const word = done ? "Done" : kind === "not-met" ? "Failed" : kind === "pending" ? "Running" : "Not reached";
        return <li key={name} className="flex items-center justify-between gap-3 text-sm"><span className="text-ink">{index + 1}. {STAGE_LABEL[name] ?? name}</span><StatusMark size="sm" kind={kind} label={word} /></li>;
      })}
    </ol>
  );
}

/* Gate evidence recorded when the run started: security findings and the
monthly model estimate. */
export function GatesPanel({ run, status, completed, timeline }: { run: Deployment | null; status: string; completed: string[]; timeline: DeploymentTimeline[] }) {
  const security = run?.stages?.find((s) => s.name === "SecurityScan");
  const cost = run?.stages?.find((s) => s.name === "CostEstimate");
  const issues = (security?.details?.issues as string[] | undefined) ?? null;
  const items = (cost?.details?.lineItems as Array<{ resourceId: string; type: string; skuLabel?: string; monthlyUsd: number }> | undefined) ?? [];
  const monthly = cost?.details?.monthlyEstimate as number | undefined;
  const failure = timeline.filter((e) => /failed|interrupted/i.test(e.event)).at(-1);
  return (
    <div className="flex flex-col">
      <section className="border-b border-line px-4 py-4">
        <h3 className="mb-3 text-[13px] font-semibold text-ink">Gates</h3>
        <GateList status={status} completed={completed} />
        {failure && status === "failed" && <p role="alert" className="mt-3 border-l-2 border-fail pl-2.5 text-sm text-ink">{failure.message}</p>}
      </section>
      <section className="border-b border-line px-4 py-4">
        <h3 className="mb-2 text-[13px] font-semibold text-ink">Security scan</h3>
        {issues === null ? <p className="text-sm text-ink-3">Not recorded yet.</p> : issues.length === 0 ? <StatusMark kind="met" label="No issues reported" /> : (
          <ul className="flex flex-col gap-1.5">{issues.map((issue, i) => <li key={i} className="border-l-2 border-warn pl-2.5 text-sm text-ink">{issue}</li>)}</ul>
        )}
      </section>
      <section className="px-4 py-4">
        <h3 className="mb-2 text-[13px] font-semibold text-ink">Monthly estimate</h3>
        {monthly === undefined ? <p className="text-sm text-ink-3">Not recorded yet.</p> : <>
          <table className="w-full text-sm">
            <caption className="sr-only">Monthly model estimate by resource</caption>
            <thead className="sr-only"><tr><th scope="col">Resource</th><th scope="col">Monthly estimate</th></tr></thead>
            <tbody>{items.map((item) => <tr key={item.resourceId} className="border-b border-line/60"><th scope="row" className="py-1 text-left font-normal text-ink-2">{item.skuLabel ?? `${item.type} · ${item.resourceId}`}</th><td className="if-num py-1 text-right text-ink">{formatUsd(item.monthlyUsd)}</td></tr>)}</tbody>
            <tfoot><tr><th scope="row" className="pt-2 text-left font-semibold text-ink">Total</th><td className="if-num pt-2 text-right font-semibold text-ink">{formatUsd(monthly)}</td></tr></tfoot>
          </table>
          <p className="mt-2 text-xs text-ink-3">A model estimate for learning, not a cloud bill.</p>
        </>}
      </section>
    </div>
  );
}
