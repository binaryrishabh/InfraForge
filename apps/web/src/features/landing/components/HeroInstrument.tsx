import { useEffect, useMemo, useRef, useState } from "react";
import { HEALTH_LABEL } from "../healthLabels";
import { Timetable } from "@/features/timetable/Timetable";
import { StationMap } from "@/features/timetable/StationMap";
import { statesAt } from "@/features/timetable/stationStates";
import { sampleAt } from "@/features/timetable/model";
import { Legend } from "@/features/timetable/Legend";
import { faultLabel } from "@/features/timetable/fromTrace";
import { cx } from "@/ui/cx";
import { landingModel, landingSample as run } from "../sample";

const CHOICES = ["healthy", "degraded", "saturated", "failed"] as const;
type Phase = "ask" | "playing" | "revealed";

/* The landing page's one live thing: a real recorded run, stopped at the moment of the
fault. You commit to what the database will be at the judged second, then the recorded
run plays to the end and you can move through all of it. */
export function HeroInstrument() {
  const model = useMemo(() => landingModel(), []);
  const db = run.stations.find((s) => s.type === "Database")!.id;
  const recorded = sampleAt(model.lanes[db]!.samples, run.evaluation, 1)!.health;
  const [phase, setPhase] = useState<Phase>("ask");
  const [answer, setAnswer] = useState<string | null>(null);
  const [cursor, setCursor] = useState(run.fault.at);
  const [horizon, setHorizon] = useState(run.fault.at + 1);
  const frame = useRef(0);

  const commit = (choice: string) => {
    setAnswer(choice); setPhase("playing");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { setCursor(run.evaluation); setHorizon(run.evaluation + 1); setPhase("revealed"); return; }
    // The first animation frame's timestamp starts the clock.
    let start: number | null = null;
    const from = run.fault.at, span = run.evaluation - from, ms = 3600;
    const step = (now: number) => {
      start ??= now;
      const k = Math.min(1, (now - start) / ms), t = Math.round(from + span * k);
      setCursor(t); setHorizon(t + 1);
      if (k < 1) frame.current = requestAnimationFrame(step);
      else { setHorizon(run.evaluation + 1); setPhase("revealed"); }
    };
    frame.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const nodes = run.stations.map((s) => ({ id: s.id, type: s.type, label: s.label }));
  const edges = run.connections.map(([source, target]) => ({ source, target }));
  return (
    <div className="relative border border-line bg-surface shadow-e3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <p className="text-sm font-semibold text-ink">{run.challenge.title}<span className="font-normal text-ink-3"> · a recorded run</span></p>
        <p className="if-num text-xs text-ink-3">{run.workload.replace(/\.$/, "")}</p>
      </div>
      <div className="if-paper-grid relative bg-canvas px-2 pt-2">
        <p className="absolute left-4 top-3 z-10 text-xs text-ink-3">Second <span className="if-num font-semibold text-ink">{cursor}</span></p>
        <StationMap nodes={nodes} edges={edges} states={statesAt(model, cursor)} marked={run.fault.target}
          markLabel={`${faultLabel(run.fault.type)} at ${run.fault.at}s`} label={`Architecture at second ${cursor}`} className="mx-auto max-h-[300px]" />
      </div>
      <div className="border-t border-line px-4 py-4">
        {phase === "ask" ? (
          <fieldset>
            <legend className="text-[15px] font-semibold text-ink">{run.fault.target} crashes at second {run.fault.at}. At second {run.evaluation}, what will the database be?</legend>
            <p className="mt-1 text-sm text-ink-3">Lock an answer to play the rest of the recorded run.</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CHOICES.map((c) => (
                <button key={c} type="button" onClick={() => commit(c)}
                  className="h-10 border border-accent/50 bg-accent-soft px-3 text-sm font-semibold text-accent transition-colors hover:border-accent hover:bg-accent hover:text-inverse">
                  {HEALTH_LABEL[c]}
                </button>
              ))}
            </div>
          </fieldset>
        ) : (
          <div role="status" aria-live="polite" className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <p className="text-[15px]"><span className="text-ink-3">You said </span><span className="font-semibold text-accent">{HEALTH_LABEL[answer!]}</span></p>
            <p className={cx("text-[15px] transition-opacity", phase === "revealed" ? "opacity-100" : "opacity-0")}>
              <span className="text-ink-3">The simulator recorded </span><span className="font-semibold text-hot">{HEALTH_LABEL[recorded]}</span>
              <span className="text-ink-3"> at second {run.evaluation}{phase === "revealed" && answer === recorded ? ". You called it." : "."}</span>
            </p>
          </div>
        )}
      </div>
      <div className="border-t border-line px-4 pb-3 pt-4">
        <Timetable model={model} cursor={cursor} onCursor={setCursor} horizon={phase === "revealed" ? null : horizon}
          label="Recorded run timetable. After you answer, use the arrow keys to move through every second." />
        <Legend className="mt-3" unknown={false} />
      </div>
    </div>
  );
}
