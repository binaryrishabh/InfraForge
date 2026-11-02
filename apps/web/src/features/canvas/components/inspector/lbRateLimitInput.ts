import { LB_RATE_BURST_MAX, LB_RATE_MIN_RPS, LB_RATE_MAX_RPS } from "@infraforge/domain/resource";

// Typed text becomes a saved number only when it is complete and in range; otherwise the caller keeps the draft
// and shows the message, so clearing a field to type a new value never switches the limiter off.
export type LimitInput = { ok: true; value: number } | { ok: false; message: string };

export function parseBurst(text: string): LimitInput {
  const value = Number(text);
  if (text.trim() === "" || !Number.isInteger(value) || value < 1 || value > LB_RATE_BURST_MAX) return { ok: false, message: `Enter a whole number from 1 to ${LB_RATE_BURST_MAX.toLocaleString()}.` };
  return { ok: true, value };
}

export function parseSustainedRate(text: string): LimitInput {
  const value = Number(text);
  if (text.trim() === "" || !Number.isFinite(value) || value < LB_RATE_MIN_RPS || value > LB_RATE_MAX_RPS) return { ok: false, message: `Enter a rate from ${LB_RATE_MIN_RPS} to ${LB_RATE_MAX_RPS.toLocaleString()} requests per second.` };
  return { ok: true, value };
}
