import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "@/ui/cx";
import { formatTime, type TimetableModel } from "./model";
import { naturalHeight, timetableGeometry } from "./geometry";
import { drawTimetable } from "./draw";
import { readPalette } from "./palette";
import { momentsOf, snapTime } from "./moments";

interface TimetableProps {
  model: TimetableModel;
  cursor: number | null;
  onCursor: (t: number) => void;
  focus?: string | null;
  label: string;
  minHeight?: number;
  className?: string;
  // Time after this has not been shown yet; see drawTimetable.
  horizon?: number | null;
  // Denser lanes for a timetable that shares the screen with other work, such as the live run.
  compact?: boolean;
}

/* The timetable canvas. It is also a slider: arrow keys step between recorded moments,
Home and End jump to the ends, and the value is announced as modeled time. */
export function Timetable({ model, cursor, onCursor, focus = null, label, minHeight = 0, className, horizon = null, compact = false }: TimetableProps) {
  const wrap = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0), [theme, setTheme] = useState(0);
  const height = Math.max(minHeight, naturalHeight(model, compact ? 28 : 56));

  useEffect(() => {
    if (!wrap.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    observer.observe(wrap.current);
    // Redraw when the theme changes; canvas colours are read from CSS tokens.
    const themes = new MutationObserver(() => setTheme((n) => n + 1));
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { observer.disconnect(); themes.disconnect(); };
  }, []);

  useEffect(() => {
    const c = canvas.current; if (!c || !width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr); c.height = Math.round(height * dpr);
    const g = c.getContext("2d"); if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTimetable(g, model, timetableGeometry(model, width, height), readPalette(c), cursor, focus, horizon);
  }, [model, width, height, cursor, focus, theme, horizon]);

  const moments = momentsOf(model);
  const pick = useCallback((e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = snapTime(model, timetableGeometry(model, rect.width, rect.height).timeAt(e.clientX - rect.left), moments);
    onCursor(horizon === null ? t : Math.min(t, horizon));
  }, [model, moments, onCursor, horizon]);

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const now = cursor ?? model.end, i = moments.findIndex((m) => m >= now);
    const at = (n: number) => moments[Math.max(0, Math.min(moments.length - 1, n))]!;
    const next = e.key === "ArrowRight" || e.key === "ArrowUp" ? at((moments[i] === now ? i : i - 1) + 1)
      : e.key === "ArrowLeft" || e.key === "ArrowDown" ? at((i < 0 ? moments.length : i) - 1)
      : e.key === "Home" ? moments[0] : e.key === "End" ? moments.at(-1) : undefined;
    if (next === undefined) return;
    e.preventDefault(); onCursor(horizon === null ? next : Math.min(next, horizon));
  };

  return (
    <div ref={wrap} className={cx("relative w-full select-none", className)}>
      <div role="slider" tabIndex={0} aria-label={label} aria-valuemin={model.start} aria-valuemax={model.end}
        aria-valuenow={cursor ?? model.end} aria-valuetext={`Modeled time ${formatTime(cursor ?? model.end, model.unit)}`}
        onKeyDown={key} className="rounded-sm outline-offset-4">
        <canvas ref={canvas} aria-hidden="true" style={{ width: "100%", height }} className="block touch-none"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e); }}
          onPointerMove={(e) => { if (e.buttons & 1) pick(e); }} />
      </div>
    </div>
  );
}
