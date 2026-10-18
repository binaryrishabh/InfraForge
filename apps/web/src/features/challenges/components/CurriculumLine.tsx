import { Link } from "react-router-dom";
import type { ChallengeSummary } from "@infraforge/contracts/challenges";
import { StatusGlyph } from "@/ui/StatusMark";
import { cx } from "@/ui/cx";
import { DIFFICULTY_LABEL, RESULT_LABEL } from "../challengeLabels";

const LINES = {
  design: { title: "Design line", note: "Fixed traffic, fixed requirements." },
  resilience: { title: "Resilience line", note: "One named part breaks at a set second." },
} as const;

/* The curriculum drawn as two transit lines. Each challenge is a station; its mark is
the recorded result of its latest attempt. Wide screens read left to right, narrow
screens top to bottom, with the same order. */
export function CurriculumLine({ challenges, next, className }: { challenges: ChallengeSummary[]; next?: string | null; className?: string }) {
  return (
    <div className={cx("space-y-8", className)}>
      {(["design", "resilience"] as const).map((category) => {
        const items = challenges.filter((c) => c.category === category);
        if (!items.length) return null;
        return (
          <section key={category} aria-label={LINES[category].title}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-[15px] font-semibold text-ink">{LINES[category].title}</h3>
              <p className="text-sm text-ink-3">{LINES[category].note} {items.filter((c) => c.met).length} of {items.length} met.</p>
            </div>
            <ol className="relative mt-4 grid gap-y-3 md:flex md:gap-0">
              <li aria-hidden="true" className="pointer-events-none absolute bottom-3 left-[7px] top-3 w-px bg-line-strong md:inset-x-[7px] md:bottom-auto md:top-[7px] md:h-px md:w-auto" />
              {items.map((c) => {
                const kind = c.met ? "met" : c.latest?.status ?? "not-started";
                const status = c.met ? "Met" : c.latest ? RESULT_LABEL[c.latest.status] : c.workspaceDesignId ? "Design started" : "Not started";
                return (
                  <li key={c.id} className="relative min-w-0 md:flex-1 md:pr-4">
                    <Link to={`/challenges/${c.id}`} aria-label={`${c.title}, ${DIFFICULTY_LABEL[c.difficulty]}, ${status}${next === c.id ? ", suggested next" : ""}`}
                      className="group flex items-start gap-3 rounded-sm outline-offset-4 md:flex-col md:gap-2">
                      <span className={cx("relative grid size-[15px] shrink-0 place-items-center bg-bg", next === c.id && "outline-2 outline-offset-[3px] outline-accent [outline-style:solid]")}>
                        <StatusGlyph kind={kind} size={15} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[14px] font-semibold leading-snug text-ink group-hover:underline">{c.title}</span>
                        <span className="mt-0.5 block text-xs text-ink-3">{DIFFICULTY_LABEL[c.difficulty]} · {status}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
