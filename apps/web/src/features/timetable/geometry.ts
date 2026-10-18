import type { TimetableModel } from "./model";

export interface Geometry {
  width: number; height: number;
  left: number; right: number; top: number; bottom: number;
  laneHeight: number; systemY: number | null;
  x: (t: number) => number;
  timeAt: (px: number) => number;
  laneY: (station: string) => number;
}

/* One geometry is shared by drawing and pointer input so a click lands on the moment
that was drawn under it. Lanes keep a readable minimum height; the canvas grows instead. */
export function timetableGeometry(model: TimetableModel, width: number, height: number): Geometry {
  const narrow = width < 560;
  const left = narrow ? 76 : 132, right = narrow ? 12 : 24, top = 34, bottom = 26;
  const systemBlock = model.system.length ? 34 : 0;
  const n = Math.max(1, model.stations.length);
  const laneHeight = Math.max(26, Math.min(72, (height - top - bottom - systemBlock) / n));
  const span = Math.max(1, model.end - model.start);
  const x = (t: number) => left + ((t - model.start) / span) * (width - left - right);
  const timeAt = (px: number) => model.start + ((px - left) / Math.max(1, width - left - right)) * span;
  const index = new Map(model.stations.map((s, i) => [s.id, i]));
  const laneY = (station: string) => top + systemBlock + laneHeight * ((index.get(station) ?? 0) + 0.5);
  return { width, height, left, right, top, bottom, laneHeight, systemY: systemBlock ? top + systemBlock / 2 - 2 : null, x, timeAt, laneY };
}

export function naturalHeight(model: TimetableModel, perStation = 56) {
  return 34 + 26 + (model.system.length ? 34 : 0) + model.stations.length * perStation;
}
