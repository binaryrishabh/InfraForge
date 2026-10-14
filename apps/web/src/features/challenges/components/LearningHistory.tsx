import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import type { LearningAttempt } from "@infraforge/contracts/challenges";
import { getLearningHistory } from "@/api/challenges.api";
import { useRequest } from "@/api/useRequest";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { formatDate } from "@/lib/format";
import { Button } from "@/ui/Button";
import { Loading, Notice, Section } from "@/ui/Page";
import { StatusMark } from "@/ui/StatusMark";
import { RESULT_LABEL } from "../challengeLabels";
import { faultLabel } from "../experiment";
import { useOpenChallenge } from "../useOpenChallenge";

export function LearningAttemptList({ attempts }: { attempts: LearningAttempt[] }) {
  const { open, busy } = useOpenChallenge();
  return <ol className="divide-y divide-line border-y border-line">
    {attempts.map((attempt) => <li key={attempt.runId} className="grid min-w-0 gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0"><p className="if-eyebrow">{attempt.category === "resilience" ? "Resilience" : "Design"} · version {attempt.version}{attempt.fault ? ` · ${faultLabel(attempt.fault)}` : ""}</p>
        <Link to={`/runs/${attempt.runId}`} className="mt-1 block break-words text-[15px] font-semibold text-ink hover:underline">{attempt.title}</Link>
        <time className="text-xs text-ink-3" dateTime={attempt.createdAt}>{formatDate(attempt.createdAt)}</time>
        <p className="mt-1 text-sm text-ink-2">{attempt.total ? `${attempt.metCount} of ${attempt.total} requirements met` : "Requirements not evaluated"} · {attempt.predictionTotal ? `${attempt.predictionMatched} of ${attempt.predictionTotal} predictions matched${attempt.predictionKnown < attempt.predictionTotal ? `; ${attempt.predictionTotal - attempt.predictionKnown} unknown` : ""}` : "Predictions unavailable"}</p>
      </div>
      <div className="flex flex-wrap items-start gap-2 sm:flex-col sm:items-end"><StatusMark kind={attempt.status} label={RESULT_LABEL[attempt.status]} />
        <Link to={`/runs/${attempt.runId}`} className="text-sm font-medium text-accent hover:underline">Read the report</Link>
        {attempt.canRetry && <Button size="sm" variant="ghost" loading={busy === attempt.challengeId} onClick={() => void open(attempt.challengeId)}>Improve / try again{attempt.latestVersion !== attempt.version ? ` · v${attempt.latestVersion}` : ""}</Button>}
      </div>
    </li>)}
  </ol>;
}

export function LearningHistory({ limit = 8 }: { limit?: number }) {
  const ownerId = useAuthStore((s) => s.user?.id);
  const [page, setPage] = useState<{ ownerId: string | undefined; before?: string }>({ ownerId });
  const before = page.ownerId === ownerId ? page.before : undefined;
  const setBefore = (value: string | undefined) => setPage({ ownerId, before: value });
  const load = useCallback(() => { if (!ownerId) return Promise.reject(new Error("Session unavailable")); return getLearningHistory(limit, before); }, [limit, before, ownerId]);
  const { data, loading, error, retry } = useRequest(load, "Learning history could not be loaded. Your session may have ended.");
  return <Section title="Recent learning" id="learning-history" className="mt-8">
    <p className="mb-3 text-sm text-ink-3">Attempts across challenges, newest first. Requirements and predictions are separate recorded facts.</p>
    {loading ? <Loading label="Loading learning history…" /> : error || !data ? <><Notice tone="warn" role="status">{error}</Notice><Button className="mt-2" size="sm" onClick={retry}>Try again</Button></> : <>
      {data.attempts.length ? <LearningAttemptList attempts={data.attempts} /> : <p className="text-sm text-ink-3">No challenge attempts yet.</p>}
      <div className="mt-3 flex flex-wrap gap-2">{before && <Button size="sm" onClick={() => setBefore(undefined)}>Newest attempts</Button>}
        {data.nextCursor && <Button size="sm" onClick={() => setBefore(data.nextCursor!)}>Older attempts</Button>}</div>
    </>}
  </Section>;
}
