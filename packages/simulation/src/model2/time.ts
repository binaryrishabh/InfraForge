export type Micros = number & { readonly __unit: "us" };
export function micros(value: number): Micros {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Time must be nonnegative safe integer microseconds");
  return value as Micros;
}
export const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
interface Event { at: Micros; priority: number; key: string; run: () => void }
const compare = (a: Event, b: Event) => a.at - b.at || a.priority - b.priority || lexical(a.key, b.key);

// Event time is independent of wall time and UI playback speed. Equal-time order is contractual.
export class EventKernel {
  now = micros(0);
  processed = 0;
  peakPending = 0;
  private heap: Event[] = [];
  private keys = new Set<string>();
  constructor(readonly maxEvents: number) {
    if (!Number.isSafeInteger(maxEvents) || maxEvents <= 0) throw new Error("Invalid event budget");
  }
  schedule(at: number, priority: number, key: string, run: () => void) {
    if (at < this.now || !Number.isSafeInteger(priority) || !key || this.keys.has(key)) throw new Error("Past, invalid or duplicate event");
    if (this.heap.length + this.processed >= this.maxEvents) throw new Error("Event budget exhausted; evidence is incomplete");
    const event = { at: micros(at), priority, key, run };
    this.keys.add(key); this.heap.push(event);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >>> 1;
      if (compare(this.heap[parent]!, event) <= 0) break;
      this.heap[i] = this.heap[parent]!; i = parent;
    }
    this.heap[i] = event; this.peakPending = Math.max(this.peakPending, this.heap.length);
  }
  advanceTo(until: number) {
    micros(until);
    if (until < this.now) throw new Error("Cannot reverse simulation time");
    while (this.heap[0] && this.heap[0].at <= until) {
      const event = this.heap[0], last = this.heap.pop()!;
      if (this.heap.length) {
        let i = 0;
        while (i * 2 + 1 < this.heap.length) {
          let child = i * 2 + 1;
          if (child + 1 < this.heap.length && compare(this.heap[child + 1]!, this.heap[child]!) < 0) child++;
          if (compare(last, this.heap[child]!) <= 0) break;
          this.heap[i] = this.heap[child]!; i = child;
        }
        this.heap[i] = last;
      }
      this.keys.delete(event.key); this.now = event.at; this.processed++; event.run();
    }
    this.now = micros(until);
  }
}
