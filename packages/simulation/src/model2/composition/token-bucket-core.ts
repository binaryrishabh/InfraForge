export interface TokenBucketState {
  capacity: number; refill: number; period: number; anchor: number; tokens: number;
  retainedRefillTokens: number; received: number; admitted: number; rejected: number;
}
export const bucketInteger = (value: number, minimum: number) => {
  if (!Number.isSafeInteger(value) || value < minimum) throw Error("Invalid token bucket quantity");
  return value;
};

export function tokenBucketState(capacity: number, initial: number, refill: number, period: number, now: number): TokenBucketState {
  bucketInteger(capacity, 1); bucketInteger(initial, 0); bucketInteger(refill, 1); bucketInteger(period, 1); bucketInteger(now, 0);
  if (initial > capacity) throw Error("Initial tokens exceed capacity");
  return { capacity, refill, period, anchor: now, tokens: initial, retainedRefillTokens: 0, received: 0, admitted: 0, rejected: 0 };
}

// Projection never spends or mutates credits. Saturation discards excess refill.
export function projectTokens(s: TokenBucketState, now: number): TokenBucketState {
  bucketInteger(now, s.anchor);
  const steps = Math.floor((now - s.anchor) / s.period), room = s.capacity - s.tokens;
  const added = steps >= Math.ceil(room / s.refill) ? room : steps * s.refill;
  return { ...s, anchor: s.anchor + steps * s.period, tokens: s.tokens + added, retainedRefillTokens: bucketInteger(s.retainedRefillTokens + added, 0) };
}

// Every admission spends once, including requests which later fail or cancel.
export function takeToken(s: TokenBucketState, now: number) {
  const next = projectTokens(s, now), admitted = next.tokens >= 1;
  next.received = bucketInteger(next.received + 1, 0);
  if (admitted) { next.tokens--; next.admitted = bucketInteger(next.admitted + 1, 0); }
  else next.rejected = bucketInteger(next.rejected + 1, 0);
  return { state: next, admitted };
}
