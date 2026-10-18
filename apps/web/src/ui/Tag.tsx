import type { ReactNode } from "react";
import { cx } from "./cx";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "hot" | "fail" | "marker";
const TONE: Record<Tone, string> = {
  neutral: "border-line-strong text-ink-2 bg-surface",
  accent: "border-accent/40 text-accent bg-accent-soft",
  ok: "border-ok/40 text-ok bg-ok-soft",
  warn: "border-warn/40 text-warn bg-warn-soft",
  hot: "border-hot/40 text-hot bg-hot-soft",
  fail: "border-fail/40 text-fail bg-fail-soft",
  marker: "border-accent/50 text-accent bg-accent-soft",
};

export function Tag({ tone = "neutral", children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1 h-6 px-2 rounded-sm border text-xs font-medium whitespace-nowrap", TONE[tone], className)}>
      {icon}{children}
    </span>
  );
}
