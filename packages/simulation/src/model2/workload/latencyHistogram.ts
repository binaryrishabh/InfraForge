// Singleton buckets below 32 us, then 32 equal integer subdivisions per power of two.
// All safe integer microseconds fit in 1,568 counters (12,544 bytes), allocated once.
export function latencyBucket(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Latency must be safe integer microseconds");
  if (value < 32) return { index: value, lowUs: value, highUs: value };
  let exponent = Math.min(52, Math.floor(Math.log2(value)));
  // IEEE-754 log2 can round up just below a power of two.
  if (value < 2 ** exponent) exponent--;
  const base = 2 ** exponent, width = 2 ** (exponent - 5);
  const sub = Math.floor((value - base) / width), lowUs = base + sub * width;
  return { index: 32 + (exponent - 5) * 32 + sub, lowUs, highUs: lowUs + width - 1 };
}

export class LatencyHistogram {
  private readonly counters = new Float64Array(1568);
  count = 0;
  minUs: number | null = null;
  maxUs: number | null = null;
  get counterCount() { return this.counters.length; }
  get counterBytes() { return this.counters.byteLength; }
  record(value: number) {
    const bucket = latencyBucket(value);
    this.counters[bucket.index]!++;
    this.count++;
    this.minUs = this.minUs === null ? value : Math.min(this.minUs, value);
    this.maxUs = this.maxUs === null ? value : Math.max(this.maxUs, value);
  }
  percentile(p: 0.5 | 0.95 | 0.99): { lowUs: number; highUs: number } | null {
    if (this.count < Math.round(1 / (1 - p))) return null;
    const rank = Math.ceil(p * this.count);
    let seen = 0;
    for (let i = 0; i < this.counters.length; i++) {
      seen += this.counters[i]!;
      if (seen < rank) continue;
      if (i < 32) return { lowUs: i, highUs: i };
      const exponent = 5 + Math.floor((i - 32) / 32), width = 2 ** (exponent - 5);
      const lowUs = 2 ** exponent + ((i - 32) % 32) * width;
      return { lowUs, highUs: lowUs + width - 1 };
    }
    throw new Error("Latency rank exceeds histogram population");
  }
}
