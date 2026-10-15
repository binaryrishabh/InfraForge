import { lexical } from "../time";

// Max-min equal sharing with per-invocation parallelism caps. Capacity left by a
// capped job is reusable by eligible work; a blocked worker is not in this set.
export function fairShares(jobs: Array<{ id: string; cap: number }>, capacity: number): Map<string, number> {
  const ordered = [...jobs].sort((a, b) => a.cap - b.cap || lexical(a.id, b.id)), shares = new Map<string, number>();
  let left = capacity;
  for (let i = 0; i < ordered.length; i++) {
    const job = ordered[i]!, share = Math.min(job.cap, Math.max(0, left) / (ordered.length - i));
    shares.set(job.id, share); left -= share;
  }
  return shares;
}
