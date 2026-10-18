import { formatTime, type TimetableModel, type Train } from "./model";
import type { Geometry } from "./geometry";
import { healthColor, healthWeight, type Palette } from "./palette";

// Consecutive journal events that describe one continuous, recorded movement or dwell.
const RECORDED_STEPS = new Set([
  "caller-offered>lb-received", "lb-received>app-admitted", "app-admitted>app-start", "app-start>app-dependency",
  "app-dependency>db-admitted", "db-admitted>db-statement", "db-statement>db-statement", "db-statement>db-terminal",
  "db-terminal>app-terminal", "app-start>app-terminal", "app-terminal>caller-terminal",
]);

function hatch(g: CanvasRenderingContext2D, p: Palette, x0: number, y0: number, w: number, h: number) {
  g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
  g.strokeStyle = p.ink3; g.globalAlpha = 0.28; g.lineWidth = 1;
  for (let k = -h; k < w + h; k += 6) { g.beginPath(); g.moveTo(x0 + k, y0 + h); g.lineTo(x0 + k + h, y0); g.stroke(); }
  g.restore();
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = "left") {
  g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = "middle"; g.fillText(text, x, y);
}

/* `horizon` hides everything after a moment that has not been shown yet (the landing
page's run before you predict). Hidden time is drawn as an empty dotted rail, which is
deliberately unlike the hatching used for evidence that was not retained. */
export function drawTimetable(g: CanvasRenderingContext2D, model: TimetableModel, geo: Geometry, p: Palette, cursor: number | null, focus: string | null, horizon: number | null = null) {
  const { left, top, bottom, height, width } = geo;
  const plotTop = top - 6, plotBottom = height - bottom + 2, step = model.unit === "s" ? 1 : 0;
  g.clearRect(0, 0, width, height);
  const visible = (t: number) => horizon === null || t < horizon;

  // Whole-run windows behind everything.
  for (const w of model.windows) {
    const x0 = geo.x(Math.max(model.start, w.from)), x1 = geo.x(Math.min(model.end, w.to));
    if (x1 <= x0) continue;
    if (w.kind === "unknown") hatch(g, p, x0, plotTop, x1 - x0, plotBottom - plotTop);
    else if (w.kind === "fault") { g.fillStyle = p.failed; g.globalAlpha = 0.07; g.fillRect(x0, plotTop, x1 - x0, plotBottom - plotTop); g.globalAlpha = 1; }
  }

  // Time axis.
  const span = model.end - model.start, ticks = niceTicks(span, Math.max(3, Math.floor((width - left) / 110)));
  g.lineWidth = 1;
  for (let t = Math.ceil(model.start / ticks) * ticks; t <= model.end; t += ticks) {
    const X = Math.round(geo.x(t)) + 0.5;
    g.strokeStyle = p.grid; g.beginPath(); g.moveTo(X, plotTop); g.lineTo(X, plotBottom); g.stroke();
    label(g, formatTime(t, model.unit), X, height - bottom / 2 + 2, `11px ${p.mono}`, p.ink3, "center");
  }

  // System health, a thinner rail above the stations.
  if (geo.systemY !== null) {
    label(g, "System", 0, geo.systemY, `600 12px ${p.sans}`, p.ink2);
    g.strokeStyle = p.lineStrong; g.lineWidth = 1; g.beginPath(); g.moveTo(left, geo.systemY); g.lineTo(geo.x(model.end), geo.systemY); g.stroke();
    for (const s of model.system) {
      if (s.health === "healthy" || !visible(s.t)) continue;
      g.strokeStyle = healthColor(p, s.health); g.lineWidth = healthWeight(s.health) - 1;
      g.beginPath(); g.moveTo(geo.x(s.t), geo.systemY); g.lineTo(geo.x(s.t + (step || 1)), geo.systemY); g.stroke();
    }
  }

  // Station rails.
  for (const station of model.stations) {
    const y = geo.laneY(station.id), lane = model.lanes[station.id], dim = focus !== null && focus !== station.id;
    g.globalAlpha = dim ? 0.38 : 1;
    // Dense lanes keep the name only; the type is on the map beside it.
    const typed = !!station.type && geo.laneHeight >= 34;
    label(g, station.label, 0, y - (typed ? 7 : 0), `650 13px ${p.sans}`, p.ink);
    if (typed) label(g, station.type!, 0, y + 9, `11px ${p.sans}`, p.ink3);
    g.strokeStyle = p.lineStrong; g.lineWidth = 1; g.beginPath(); g.moveTo(left, y); g.lineTo(geo.x(model.end), y); g.stroke();

    if (lane) {
      // Modeled CPU as a faint field above the rail. Gaps stay empty: nothing is interpolated.
      const h = geo.laneHeight * 0.36;
      g.fillStyle = p.ink; g.globalAlpha = (dim ? 0.38 : 1) * 0.15;
      for (const s of lane.samples) if (s.cpu !== undefined && visible(s.t)) { const x0 = geo.x(s.t), x1 = geo.x(s.t + (step || 1)); g.fillRect(x0, y - (s.cpu / 100) * h - 1, Math.max(1, x1 - x0 - 0.5), (s.cpu / 100) * h); }
      g.globalAlpha = dim ? 0.38 : 1;
      for (const s of lane.samples) {
        if (s.health === "healthy" || !visible(s.t)) continue;
        g.strokeStyle = healthColor(p, s.health); g.lineWidth = healthWeight(s.health);
        g.beginPath(); g.moveTo(geo.x(s.t), y); g.lineTo(geo.x(s.t + (step || 1)), y); g.stroke();
      }
      // Failed seconds also carry a cross-hatch tick so failure reads without colour.
      for (const s of lane.samples) if (s.health === "failed" && visible(s.t)) { const X = geo.x(s.t + 0.5); g.strokeStyle = p.bg; g.lineWidth = 1.2; g.beginPath(); g.moveTo(X - 2, y - 2.5); g.lineTo(X + 2, y + 2.5); g.stroke(); }
      lane.bands.forEach((band, k) => {
        // Chalk blue stays reserved for the learner; the load balancer's view is drawn in ink.
        const by = y + 9 + k * 6, col = band.kind === "down" ? p.failed : band.kind === "unready" ? p.degraded : p.ink2;
        g.fillStyle = col; g.fillRect(geo.x(band.from), by, Math.max(2, geo.x(band.to) - geo.x(band.from)), 3);
      });
    }
    g.globalAlpha = 1;
  }

  for (const train of model.trains) drawTrain(g, geo, p, train, focus);

  if (horizon !== null && horizon < model.end) {
    const X = geo.x(horizon);
    g.fillStyle = p.bg; g.globalAlpha = 0.86; g.fillRect(X, plotTop, geo.x(model.end) - X + 2, plotBottom - plotTop); g.globalAlpha = 1;
    g.strokeStyle = p.ink3; g.lineWidth = 1; g.setLineDash([1, 5]);
    for (const station of model.stations) { const y = geo.laneY(station.id); g.beginPath(); g.moveTo(X, y); g.lineTo(geo.x(model.end), y); g.stroke(); }
    g.setLineDash([]);
  }

  // Marks: the fault boundary and the judged moment. A label that would run into the
  // judged label is set on the other side of its line instead.
  const markFont = `600 11px ${p.sans}`;
  g.font = markFont;
  const judged = model.marks.find((m) => m.kind === "evaluation");
  const judgedLeft = judged ? geo.x(judged.t) - 6 - g.measureText(judged.label).width : Infinity;
  for (const m of model.marks) {
    const X = Math.round(geo.x(m.t)) + 0.5;
    g.strokeStyle = m.kind === "fault" ? p.failed : p.ink2; g.lineWidth = 1; g.setLineDash(m.kind === "evaluation" ? [] : [3, 3]);
    g.beginPath(); g.moveTo(X, plotTop); g.lineTo(X, plotBottom); g.stroke(); g.setLineDash([]);
    g.font = markFont;
    const before = m.kind === "evaluation" || (m !== judged && X + 6 + g.measureText(m.label).width + 8 > judgedLeft);
    label(g, m.label, X + (before ? -6 : 6), top / 2 - 2, markFont, m.kind === "fault" ? p.failed : p.ink2, before ? "right" : "left");
  }

  // The learner's predictions: chalk diamonds on the stations they are about.
  for (const pr of model.predictions) {
    const X = geo.x(pr.t) - (pr.t >= model.end ? 10 : 0);
    const ys = pr.stations === "system" ? (geo.systemY !== null ? [geo.systemY] : []) : pr.stations.map((s) => geo.laneY(s));
    for (const Y of ys) {
      g.save(); g.translate(X, Y - 0.5); g.rotate(Math.PI / 4);
      g.fillStyle = pr.outcome === "matched" ? p.accent : p.bg; g.strokeStyle = p.accent; g.lineWidth = 1.6;
      g.fillRect(-4, -4, 8, 8); g.strokeRect(-4, -4, 8, 8); g.restore();
    }
  }

  if (cursor !== null) {
    const X = Math.round(geo.x(cursor)) + 0.5;
    g.strokeStyle = p.ink; g.lineWidth = 1; g.beginPath(); g.moveTo(X, plotTop - 2); g.lineTo(X, plotBottom); g.stroke();
    const text = formatTime(Math.round(cursor), model.unit);
    g.font = `600 11px ${p.mono}`; const w = g.measureText(text).width + 12;
    const bx = Math.min(width - w - 1, Math.max(left, X - w / 2));
    g.fillStyle = p.ink; g.fillRect(bx, plotBottom + 3, w, 18);
    label(g, text, bx + w / 2, plotBottom + 12.5, `600 11px ${p.mono}`, p.bg, "center");
  }
}

function drawTrain(g: CanvasRenderingContext2D, geo: Geometry, p: Palette, train: Train, focus: string | null) {
  const col = train.op === "write" ? p.write : p.read;
  const dim = focus !== null && focus !== train.id && !train.stops.some((s) => s.station === focus);
  g.globalAlpha = dim ? 0.18 : 0.95; g.lineJoin = "round"; g.lineCap = "round";
  for (let i = 1; i < train.stops.length; i++) {
    const a = train.stops[i - 1]!, b = train.stops[i]!;
    // A caller that gave up (a deadline, a cancel) did not receive the response; that last step is not a movement.
    const recorded = RECORDED_STEPS.has(`${a.kind}>${b.kind}`) && !(b.kind === "caller-terminal" && train.outcome !== "completed");
    g.strokeStyle = col; g.lineWidth = focus === train.id ? 2.6 : 1.6; g.setLineDash(recorded ? [] : [2, 4]);
    g.beginPath(); g.moveTo(geo.x(a.t), geo.laneY(a.station)); g.lineTo(geo.x(b.t), geo.laneY(b.station)); g.stroke();
  }
  g.setLineDash([]);
  if (train.commitAt !== null) {
    const db = train.stops.find((s) => s.kind === "db-terminal");
    if (db) { g.fillStyle = col; g.beginPath(); g.arc(geo.x(train.commitAt), geo.laneY(db.station), 3.4, 0, Math.PI * 2); g.fill(); }
  }
  const last = train.stops.at(-1);
  // No caller outcome by the horizon: an open ring, because the outcome is Unknown, not a failure.
  if (last && train.outcome === "in-flight") {
    g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); g.arc(geo.x(last.t), geo.laneY(last.station), 4, 0, Math.PI * 2); g.stroke();
  }
  if (last && train.outcome !== "completed" && train.outcome !== "in-flight") {
    const X = geo.x(last.t), Y = geo.laneY(last.station);
    g.strokeStyle = p.failed; g.lineWidth = 2; g.beginPath(); g.moveTo(X - 4, Y - 4); g.lineTo(X + 4, Y + 4); g.moveTo(X + 4, Y - 4); g.lineTo(X - 4, Y + 4); g.stroke();
  }
  g.globalAlpha = 1;
}

function niceTicks(span: number, target: number) {
  const raw = span / target, mag = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  for (const m of [1, 2, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}
