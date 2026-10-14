import { useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { ChallengeSummary } from "@infraforge/contracts/challenges";
import { listChallenges } from "@/api/challenges.api";
import { useRequest } from "@/api/useRequest";
import { Page, PageHeader, Loading, Notice } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { StatusMark } from "@/ui/StatusMark";
import { DIFFICULTY_LABEL, RESULT_LABEL } from "../challengeLabels";

export function ChallengeRow({ challenge, index }: { challenge: ChallengeSummary; index: number }) {
  const latest = challenge.latest;
  return (
    <li className="grid gap-x-6 gap-y-2 border-t border-line py-[calc(var(--if-list-y)+0.25rem)] sm:grid-cols-[3rem_1fr_15rem]">
      <span className="if-num text-[13px] text-ink-3">{String(index + 1).padStart(2, "0")}</span>
      <div className="min-w-0">
        <p className="if-eyebrow">{DIFFICULTY_LABEL[challenge.difficulty]} · {challenge.concepts.join(" · ")}</p>
        <h2 className="if-title mt-1 text-[22px]">
          <Link to={`/challenges/${challenge.id}`} className="rounded-sm text-ink underline-offset-4 hover:underline">{challenge.title}</Link>
        </h2>
        <p className="mt-1 max-w-[62ch] text-[15px] text-ink-2">{challenge.summary}</p>
        <p className="if-num mt-2 text-xs text-ink-3">{challenge.requirementCount} requirements · judged at second {challenge.evaluationSeconds}</p>
      </div>
      <div className="flex flex-col items-start gap-1.5 sm:items-end sm:text-right">
        {challenge.met ? <StatusMark kind="met" label="Met at least once" /> : latest ? <StatusMark kind={latest.status} label={RESULT_LABEL[latest.status]} /> : <StatusMark kind="not-started" />}
        <span className="text-xs text-ink-3">{challenge.attempts === 0 ? (challenge.workspaceDesignId ? "Design started, no attempts yet" : "No attempts yet") : `${challenge.attempts} ${challenge.attempts === 1 ? "attempt" : "attempts"}`}</span>
        <Link to={`/challenges/${challenge.id}`} className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          {challenge.attempts || challenge.workspaceDesignId ? "Continue" : "Read the brief"} <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </li>
  );
}

export function ChallengesPage() {
  const load = useCallback(() => listChallenges(), []);
  const { data, loading, error, retry } = useRequest(load, "The challenge list could not be loaded.");
  return (
    <Page>
      <PageHeader eyebrow="Challenges" title="Assignments with a fixed brief."
        lede="Each challenge fixes the traffic, the moment it is judged and the requirements. You design, commit to a prediction, run once, and compare what you expected with what was recorded." />
      {loading ? <Loading label="Loading challenges…" /> : error || !data ? (
        <div className="mt-8"><Notice tone="fail" role="alert">{error}</Notice><Button className="mt-3" size="sm" onClick={retry}>Try again</Button></div>
      ) : (
        <ol className="mt-2 border-b border-line">{data.map((challenge, index) => <ChallengeRow key={challenge.id} challenge={challenge} index={index} />)}</ol>
      )}
      <p className="mt-6 max-w-[70ch] text-sm text-ink-3">Results come from fixed rules applied to recorded run evidence. There are no scores or rankings: a requirement is met or it is not, and a prediction matches what was recorded or it does not.</p>
    </Page>
  );
}
