import { useCallback, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Radio } from "lucide-react";
import { toast } from "sonner";
import { listChallenges } from "@/api/challenges.api";
import { getAllInfrastructure } from "@/api/infrastructure.api";
import { getLiveDeployments, type LiveDeploymentSummary } from "@/api/deployment.api";
import { getRunHistory } from "@/api/reports.api";
import { useRequest } from "@/api/useRequest";
import { relativeTime, plural } from "@/lib/format";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { useOpenChallenge } from "@/features/challenges/useOpenChallenge";
import { RESULT_LABEL } from "@/features/challenges/challengeLabels";
import { reenterRun } from "@/features/live/reenterRun";
import { RunList } from "@/features/reports/components/RunList";
import { nextStep, type HomeData, type Next } from "../nextStep";
import { Button, ButtonLink } from "@/ui/Button";
import { Loading, Page, Section } from "@/ui/Page";
import { StatusMark } from "@/ui/StatusMark";
import { LearningHistory } from "@/features/challenges/components/LearningHistory";

function NextStep({ next }: { next: Next }) {
  const navigate = useNavigate();
  const { open, busy } = useOpenChallenge();
  const [entering, setEntering] = useState(false);
  const enter = async (run: LiveDeploymentSummary) => {
    setEntering(true);
    try { await reenterRun(run.id, run.infrastructureName); navigate("/design"); }
    catch { toast.error("That run is no longer live."); setEntering(false); }
  };
  const frame = (eyebrow: string, title: string, body: string, action: ReactNode) => (
    <section aria-labelledby="next-title" className="mt-8 grid gap-6 border-y-2 border-ink py-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
      <div className="min-w-0"><p className="if-eyebrow">{eyebrow}</p><h2 id="next-title" className="if-title mt-2 text-[30px] text-ink">{title}</h2><p className="mt-2 max-w-[60ch] text-[15px] text-ink-2">{body}</p></div>
      <div className="flex flex-wrap gap-2">{action}</div>
    </section>
  );
  if (next.kind === "live") return frame("A run is live", next.run.infrastructureName, `${plural(next.run.resourceCount, "resource")}, live since ${relativeTime(next.run.createdAt)}. It keeps running on the server until it is stopped${next.run.challengeId ? " or reaches its evaluation second" : ""}.`,
    <Button variant="primary" size="lg" loading={entering} icon={<Radio size={16} aria-hidden="true" />} onClick={() => void enter(next.run)}>Return to the run</Button>);
  if (next.kind === "free") return frame("Next step", "Every challenge has a recent met attempt.", "Design something of your own, run it against the traffic you choose, and compare runs as you change one thing at a time.",
    <ButtonLink to="/design" variant="primary" size="lg">Open the designer</ButtonLink>);
  const c = next.challenge;
  const copy = next.kind === "improve"
    ? { eyebrow: `Latest attempt: ${RESULT_LABEL[c.latest!.status].toLowerCase()}`, title: `Improve “${c.title}”`, body: "Read what the last attempt recorded, change one thing, and run it again under the same conditions.", label: "Improve the design" }
    : next.kind === "continue" ? { eyebrow: "In progress", title: `Continue “${c.title}”`, body: c.summary, label: "Continue designing" }
      : { eyebrow: "Suggested challenge", title: c.title, body: c.summary, label: "Start designing" };
  return frame(copy.eyebrow, copy.title, copy.body, <>
    <Button variant="primary" size="lg" loading={busy === c.id} onClick={() => void open(c.id)}>{copy.label}</Button>
    {next.kind === "improve" && c.latest ? <ButtonLink to={`/runs/${c.latest.runId}`} variant="secondary" size="lg">Read the result</ButtonLink>
      : <ButtonLink to={`/challenges/${c.id}`} variant="secondary" size="lg">Read the brief</ButtonLink>}
  </>);
}

const safe = <T,>(promise: Promise<T>, fallback: T) => promise.catch(() => fallback);

export function HomePage() {
  const user = useAuthStore((s) => s.user);
  const load = useCallback(async (): Promise<HomeData> => {
    const [live, challenges, history, designs] = await Promise.all([safe(getLiveDeployments(), []), safe(listChallenges(), []),
      safe(getRunHistory(5), { runs: [], nextCursor: null }), safe(getAllInfrastructure(), [])]);
    return { live, challenges, runs: history.runs, designs };
  }, []);
  const { data, loading } = useRequest(load);
  const met = data?.challenges.filter((c) => c.met).length ?? 0;
  return (
    <Page>
      <header className="pt-10">
        <p className="if-eyebrow">Home</p>
        <h1 className="if-display mt-2 text-[36px] sm:text-[44px]">Welcome back{user?.name ? `, ${user.name.split(" ")[0]}` : ""}.</h1>
      </header>
      {loading || !data ? <Loading label="Gathering your work…" /> : <>
        <NextStep next={nextStep(data)} />
        <div className="mt-4 grid gap-x-12 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <LearningHistory limit={5} />
            <Section title="Recent runs" className="mt-8" aside={<Link to="/runs" className="text-sm font-medium text-accent hover:underline">All runs</Link>}>
              {data.runs.length ? <RunList runs={data.runs} /> : <p className="text-sm text-ink-3">No runs yet. Attempt a challenge or run a design.</p>}
            </Section>
          </div>
          <div>
            <Section title="Challenges" className="mt-8" aside={<span className="if-num">{met} of {data.challenges.length} met recently</span>}>
              <ul className="divide-y divide-line border-y border-line">
                {data.challenges.map((c) => (
                  <li key={c.id}><Link to={`/challenges/${c.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-sunken">
                    <span className="min-w-0 truncate text-sm font-medium text-ink">{c.title}</span>
                    <StatusMark size="sm" kind={c.met ? "met" : c.latest?.status ?? "not-started"} label={c.met ? "Met" : c.latest ? RESULT_LABEL[c.latest.status] : "Not started"} />
                  </Link></li>
                ))}
              </ul>
            </Section>
            <Section title="Designs" className="mt-8" aside={<Link to="/designs" className="text-sm font-medium text-accent hover:underline">All designs</Link>}>
              {data.designs.length ? (
                <ul className="divide-y divide-line border-y border-line">
                  {data.designs.slice(0, 5).map((d) => (
                    <li key={d.id}><Link to={`/design?design=${d.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-sunken">
                      <span className="min-w-0 truncate text-sm font-medium text-ink">{d.name}</span>
                      <span className="shrink-0 text-xs text-ink-3">{d.challengeId ? "challenge · " : ""}{relativeTime(d.updatedAt)}</span>
                    </Link></li>
                  ))}
                </ul>
              ) : <p className="text-sm text-ink-3">No saved designs yet.</p>}
              <Link to="/design" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Open the designer <ArrowRight size={14} aria-hidden="true" /></Link>
            </Section>
          </div>
        </div>
      </>}
    </Page>
  );
}
