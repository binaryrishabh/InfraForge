export type Micros = number & { readonly __unit: "us" };
export function micros(value: number): Micros {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Time must be nonnegative safe integer microseconds");
  return value as Micros;
}
export const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
interface Event { at: Micros; priority: number; key: string; run: () => void; index: number }
const compare = (a: Event, b: Event) => a.at - b.at || a.priority - b.priority || lexical(a.key, b.key);

// Event time is independent of wall time and UI playback speed. Equal-time order is contractual.
export class EventKernel {
  now = micros(0);
  processed = 0;
  peakPending = 0;
  cancelled = 0;
  private heap: Event[] = [];
  private keys = new Set<string>();
  constructor(readonly maxEvents: number) {
    if (!Number.isSafeInteger(maxEvents) || maxEvents <= 0) throw new Error("Invalid event budget");
  }
  schedule(at: number, priority: number, key: string, run: () => void) {
    if (at < this.now || !Number.isSafeInteger(priority) || !key || this.keys.has(key)) throw new Error("Past, invalid or duplicate event");
    if (this.heap.length + this.processed >= this.maxEvents) throw new Error("Event budget exhausted; evidence is incomplete");
    const event = { at: micros(at), priority, key, run, index: this.heap.length };
    this.keys.add(key); this.heap.push(event);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >>> 1;
      if (compare(this.heap[parent]!, event) <= 0) break;
      this.heap[i] = this.heap[parent]!; this.heap[i]!.index = i; i = parent;
    }
    this.heap[i] = event; event.index = i; this.peakPending = Math.max(this.peakPending, this.heap.length);
    // Indexed removal releases callbacks immediately, without accumulating tombstones.
    return () => {
      if (event.index < 0) return false;
      this.remove(event.index); this.cancelled++; return true;
    };
  }
  get pending() { return this.heap.length; }
  private remove(index: number) {
    const removed = this.heap[index]!, last = this.heap.pop()!;
    removed.index = -1; this.keys.delete(removed.key);
    if (index >= this.heap.length) return removed;
    let i = index;
    if (i > 0 && compare(last, this.heap[(i - 1) >>> 1]!) < 0) {
      while (i > 0) {
        const parent = (i - 1) >>> 1;
        if (compare(this.heap[parent]!, last) <= 0) break;
        this.heap[i] = this.heap[parent]!; this.heap[i]!.index = i; i = parent;
      }
    } else {
      while (i * 2 + 1 < this.heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.heap.length && compare(this.heap[child + 1]!, this.heap[child]!) < 0) child++;
        if (compare(last, this.heap[child]!) <= 0) break;
        this.heap[i] = this.heap[child]!; this.heap[i]!.index = i; i = child;
      }
    }
    this.heap[i] = last; last.index = i; return removed;
  }
  advanceTo(until: number) {
    micros(until);
    if (until < this.now) throw new Error("Cannot reverse simulation time");
    while (this.heap[0] && this.heap[0].at <= until) {
      const event = this.remove(0);
      this.now = event.at; this.processed++; event.run();
    }
    this.now = micros(until);
  }
}
