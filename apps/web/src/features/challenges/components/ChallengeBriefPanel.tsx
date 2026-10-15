import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Copy, Lock, PenTool } from "lucide-react";
import type { ChallengeBrief, ChallengePreflight } from "@infraforge/contracts/challenges";
import { describeWorkload } from "@/lib/format";
import { Notice } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { StatusMark } from "@/ui/StatusMark";
import { RequirementList } from "./RequirementList";
import { HintReveal } from "./HintReveal";
import { ExperimentBrief } from "./ExperimentBrief";
import { PredictionList } from "./PredictionList";
import { useOpenChallenge } from "../useOpenChallenge";
import { DIFFICULTY_LABEL, RESULT_LABEL, evaluationContext } from "../challengeLabels";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <section className="border-t border-line px-4 py-4"><h3 className="mb-2 text-[13px] font-semibold text-ink">{title}</h3>{children}</section>;
}

// This workspace belongs to an earlier version: attempts need a workspace of the current one.
function OlderWorkspace({ brief, version, designId }: { brief: ChallengeBrief; version: number; designId: string | null }) {
  const { open, busy } = useOpenChallenge();
  return (
    <Notice tone="warn" className="mt-3" title={`This design is a version ${version} workspace`}>
      <p>Version {brief.latestVersion} of this challenge is current and changed what is judged. This design keeps its earlier attempts.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={<PenTool size={13} aria-hidden="true" />} loading={busy === brief.id} onClick={() => void open(brief.id, { fresh: true })}>Start version {brief.latestVersion}</Button>
        {designId && <Button size="sm" variant="ghost" icon={<Copy size={13} aria-hidden="true" />} disabled={busy !== null} onClick={() => void open(brief.id, { copyFrom: designId })}>Copy this design into it</Button>}
      </div>
    </Notice>
  );
}

/* The brief beside the canvas: never covers it. Workload and evaluation time are
fixed by the challenge and shown as locked facts. */
export function ChallengeBriefPanel({ brief, preflight, preflightError, workspaceVersion = null, designId = null }: {
  brief: ChallengeBrief; preflight: ChallengePreflight | null; preflightError: boolean; workspaceVersion?: number | null; designId?: string | null;
}) {
  const latest = brief.attempts[0];
  const older = workspaceVersion !== null && workspaceVersion < brief.latestVersion;
  return (
    <div>
      <div className="px-4 pt-4 pb-3">
        <p className="if-eyebrow">{brief.category === "resilience" ? "Resilience challenge" : "Challenge"} · {DIFFICULTY_LABEL[brief.difficulty]}</p>
        <h2 className="if-title mt-1 text-[22px] text-ink">{brief.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{brief.objective}</p>
        {latest && <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">Latest attempt: <StatusMark size="sm" kind={latest.status} label={RESULT_LABEL[latest.status]} />
          <Link to={`/runs/${latest.runId}`} className="font-medium text-accent underline-offset-2 hover:underline">Open result</Link></p>}
        {older && <OlderWorkspace brief={brief} version={workspaceVersion} designId={designId} />}
      </div>
      {brief.experiment && <Block title="The experiment">
        <ExperimentBrief experiment={brief.experiment} evaluationSeconds={brief.evaluationSeconds} readiness={preflight?.experiment} compact />
      </Block>}
      <Block title="Fixed conditions">
        <dl className="flex flex-col gap-2 text-sm">
          <div><dt className="flex items-center gap-1 text-xs text-ink-3"><Lock size={11} aria-hidden="true" /> Workload</dt><dd className="text-ink">{describeWorkload(brief.workload)}</dd></div>
          <div><dt className="flex items-center gap-1 text-xs text-ink-3"><Lock size={11} aria-hidden="true" /> Evaluated at</dt><dd className="text-ink">Simulated second {brief.evaluationSeconds}. {evaluationContext(brief.evaluationNote, brief.evaluationSeconds)}</dd></div>
        </dl>
      </Block>
      <Block title="Requirements">
        <RequirementList criteria={brief.criteria} checks={preflight?.checks} compact />
        {preflightError && <Notice tone="warn" className="mt-3">Readiness could not be checked just now. It is checked again as you edit.</Notice>}
        {preflight && preflight.errors.length > 0 && (
          <Notice tone="fail" className="mt-3" title="The design cannot run yet">
            <ul className="list-disc pl-4">{preflight.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </Notice>
        )}
      </Block>
      <Block title="Before you run">
        <p className="text-sm text-ink-2">You will commit to {brief.predictions.length === 1 ? "one prediction" : `${brief.predictions.length} predictions`} first:</p>
        <div className="mt-2"><PredictionList predictions={brief.predictions} postFault={!!brief.experiment?.postFaultObservationSeconds} /></div>
      </Block>
      <Block title="Hints"><HintReveal challengeId={brief.id} version={brief.version} hints={brief.hints} /></Block>
      <div className="border-t border-line px-4 py-4 text-sm">
        <Link to={`/challenges/${brief.id}`} className="font-medium text-accent underline-offset-2 hover:underline">Full brief and attempts</Link>
      </div>
    </div>
  );
}
