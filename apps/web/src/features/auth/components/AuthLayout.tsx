import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Wordmark } from "@/ui/Brand";
import { SkipLink } from "@/components/shell/AppShell";
import { StationMap } from "@/features/timetable/StationMap";
import { Timetable } from "@/features/timetable/Timetable";
import { statesAt } from "@/features/timetable/stationStates";
import { landingModel, landingSample as run } from "@/features/landing/sample";

/* The side panel shows a real recorded run (the same engine sample as the overview page)
at its judged second, so the first thing you see is the kind of evidence you will read. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const model = useMemo(() => landingModel(), []);
  const nodes = run.stations.map((s) => ({ id: s.id, type: s.type, label: s.label }));
  const edges = run.connections.map(([source, target]) => ({ source, target }));
  const states = statesAt(model, run.evaluation);
  const saturated = run.stations.filter((s) => states[s.id]?.health === "saturated").map((s) => s.label);
  return (
    <div className="grid min-h-dvh bg-bg text-ink lg:grid-cols-[1fr_minmax(0,560px)]">
      <SkipLink />
      <aside aria-hidden="true" inert className="if-paper-grid relative hidden flex-col justify-between gap-10 border-r border-line bg-canvas px-12 py-12 lg:flex">
        <Wordmark />
        <figure className="w-full max-w-[760px] self-center">
          <StationMap nodes={nodes} edges={edges} states={states} label="" className="max-h-[300px]" />
          <Timetable model={model} cursor={run.evaluation} onCursor={() => {}} compact className="mt-6" label="" />
          <figcaption className="mt-4 text-sm text-ink-3">{run.challenge.title}, recorded by the simulator: {run.fault.target} crashed at second {run.fault.at}; by second {run.evaluation} {saturated.length ? `${saturated.join(" and ")} ${saturated.length === 1 ? "was" : "were"} saturated` : "nothing else was saturated"}.</figcaption>
        </figure>
        <p className="if-title max-w-[36ch] text-[26px] leading-snug text-ink">Write down what you expect before you run it. The surprise is the lesson.</p>
      </aside>
      <main id="main" tabIndex={-1} className="flex flex-col px-4 py-8 outline-none sm:px-10">
        <Link to="/" className="mb-10 self-start rounded-md lg:hidden"><Wordmark /></Link>
        <div className="my-auto w-full max-w-[400px] self-center">{children}</div>
      </main>
    </div>
  );
}
