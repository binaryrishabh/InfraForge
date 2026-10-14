import { useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Lock, PenTool, RotateCcw } from "lucide-react";
import type { ChallengeBrief } from "@infraforge/contracts/challenges";
import { getChallenge } from "@/api/challenges.api";
import { useRequest } from "@/api/useRequest";
import { describeWorkload, formatDate } from "@/lib/format";
import { Page, Loading, Notice, Section } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { StatusMark } from "@/ui/StatusMark";
import { RequirementList } from "../components/RequirementList";
import { HintReveal } from "../components/HintReveal";
import { DIFFICULTY_LABEL, RESULT_LABEL, evaluationContext } from "../challengeLabels";
import { useOpenChallenge } from "../useOpenChallenge";

function startingPoint(brief: ChallengeBrief) {
  if (!brief.starter?.resources.length) return "A blank sheet. You place every resource.";
  const counts = new Map<string, number>();
  for (const r of brief.starter.resources) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  return `An existing design: ${[...counts].map(([type, n]) => `${n} × ${type}`).join(", ")}, already connected.`;
}

function ActionCard({ brief }: { brief: ChallengeBrief }) {
  const { open, busy } = useOpenChallenge();
  return (
    <div className="rounded-lg border border-line bg-raised p-5">
      <Button variant="primary" size="lg" className="w-full" loading={busy === brief.id} icon={<PenTool size={16} aria-hidden="true" />} onClick={() => void open(brief.id)}>
        {brief.workspaceDesignId ? "Continue designing" : "Start designing"}
      </Button>
      {brief.workspaceDesignId && (
        <Button variant="ghost" size="sm" className="mt-2 w-full" icon={<RotateCcw size={14} aria-hidden="true" />} onClick={() => void open(brief.id, true)} disabled={busy !== null}>
          Start over from the starting point
        </Button>
      )}
      <p className="mt-3 text-xs text-ink-3">Your challenge design is saved separately from your other designs. Starting over keeps earlier designs and attempts.</p>
    </div>
  );
}

export function ChallengeBriefView({ brief }: { brief: ChallengeBrief }) {
  const judged = brief.attempts.filter((a) => a.status === "met" || a.status === "not-met");
  return (
    <div className="grid gap-10 pt-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <article className="min-w-0">
        <p className="if-eyebrow">{DIFFICULTY_LABEL[brief.difficulty]} · {brief.concepts.join(" · ")} · version {brief.version}</p>
        <h1 className="if-display mt-3 text-[38px] sm:text-[46px]">{brief.title}</h1>
        <div className="mt-5 max-w-[64ch] space-y-3 text-[16px] leading-relaxed text-ink-2">{brief.story.map((p) => <p key={p}>{p}</p>)}</div>
        <p className="mt-5 max-w-[64ch] text-[17px] font-semibold leading-relaxed text-ink"><span className="if-mark">{brief.objective}</span></p>
        <div className="mt-6 lg:hidden"><ActionCard brief={brief} /></div>

        <Section number={1} title="Fixed conditions" className="mt-10">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div><dt className="flex items-center gap-1 text-xs text-ink-3"><Lock size={11} aria-hidden="true" /> Workload</dt><dd className="mt-0.5 text-[15px] text-ink">{describeWorkload(brief.workload)}</dd><dd className="mt-0.5 text-xs text-ink-3">The same for every attempt; you cannot change it.</dd></div>
            <div><dt className="flex items-center gap-1 text-xs text-ink-3"><Lock size={11} aria-hidden="true" /> Judged at</dt><dd className="mt-0.5 text-[15px] text-ink">Simulated second {brief.evaluationSeconds}</dd><dd className="mt-0.5 text-xs text-ink-3">{evaluationContext(brief.evaluationNote, brief.evaluationSeconds)} The attempt stops there automatically.</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-ink-3">Starting point</dt><dd className="mt-0.5 text-[15px] text-ink">{startingPoint(brief)}</dd></div>
          </dl>
        </Section>
        <Section number={2} title="Requirements" className="mt-8"><RequirementList criteria={brief.criteria} /></Section>
        <Section number={3} title="Before each attempt you predict" className="mt-8">
          <ul className="list-disc space-y-1 pl-5 text-[15px] text-ink-2">{brief.predictions.map((q) => <li key={q.id}>{q.prompt}</li>)}</ul>
          <p className="mt-2 text-sm text-ink-3">Predictions are locked when the attempt starts and are shown beside the result. They never affect whether the requirements are met.</p>
        </Section>
        <Section number={4} title="Hints" className="mt-8"><HintReveal challengeId={brief.id} version={brief.version} hints={brief.hints} /></Section>
        <Section number={5} title="Explanation" className="mt-8">
          {brief.debrief ? <div className="max-w-[64ch] space-y-3 text-[15px] leading-relaxed text-ink-2">{brief.debrief.map((p) => <p key={p}>{p}</p>)}</div>
            : <p className="text-sm text-ink-3">Unlocks after your first attempt that reaches the evaluation second and is judged.</p>}
        </Section>
      </article>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="hidden lg:block"><ActionCard brief={brief} /></div>
        <section aria-labelledby="attempts-title" className="mt-6">
          <h2 id="attempts-title" className="text-[13px] font-semibold text-ink">Your attempts {judged.length > 0 && <span className="font-normal text-ink-3">· {judged.length} judged</span>}</h2>
          {brief.attempts.length === 0 ? <p className="mt-2 text-sm text-ink-3">None yet.</p> : (
            <ol className="mt-2 divide-y divide-line border-y border-line">
              {brief.attempts.map((a) => (
                <li key={a.runId}>
                  <Link to={`/runs/${a.runId}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-sunken">
                    <span className="min-w-0"><StatusMark size="sm" kind={a.status} label={RESULT_LABEL[a.status]} /><span className="if-num block text-[11px] text-ink-3">{formatDate(a.createdAt)}</span></span>
                    {a.total > 0 && <span className="if-num shrink-0 text-xs text-ink-2">{a.metCount}/{a.total}</span>}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>
    </div>
  );
}

export function ChallengeDetailPage() {
  const { challengeId = "" } = useParams();
  const load = useCallback(() => getChallenge(challengeId), [challengeId]);
  const { data, loading, error, retry } = useRequest(load, "This challenge could not be loaded. It may not exist.");
  return (
    <Page>
      <Link to="/challenges" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink"><ArrowLeft size={14} aria-hidden="true" /> All challenges</Link>
      {loading ? <Loading label="Loading the brief…" /> : error || !data ? (
        <div className="mt-8"><Notice tone="fail" role="alert">{error}</Notice><Button className="mt-3" size="sm" onClick={retry}>Try again</Button></div>
      ) : <ChallengeBriefView brief={data} />}
    </Page>
  );
}
