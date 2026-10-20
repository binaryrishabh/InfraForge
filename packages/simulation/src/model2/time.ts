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
  constructor(readonly maxEvents: number, readonly maxPending = maxEvents) {
    if (!Number.isSafeInteger(maxEvents) || maxEvents <= 0 || !Number.isSafeInteger(maxPending) || maxPending <= 0) throw new Error("Invalid event budget");
  }
  schedule(at: number, priority: number, key: string, run: () => void) {
    if (at < this.now || !Number.isSafeInteger(priority) || !key || this.keys.has(key)) throw new Error("Past, invalid or duplicate event");
    if (this.heap.length + this.processed >= this.maxEvents) throw new Error("Event budget exhausted; evidence is incomplete");
    if (this.heap.length >= this.maxPending) throw new Error("Executor pending-event budget exhausted; evidence is incomplete");
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
  get nextAt() { return this.heap[0]?.at; }
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
  // Preserve the unsliced compatibility path without per-event slice bookkeeping.
  advanceTo(until: number) {
    micros(until);
    if (until < this.now) throw new Error("Cannot reverse simulation time");
    while (this.heap[0] && this.heap[0].at <= until) {
      const event = this.remove(0);
      this.now = event.at; this.processed++; event.run();
    }
    this.now = micros(until);
  }
  advanceSlice(until: number, events: number) {
    if (!Number.isSafeInteger(events) || events <= 0) throw new Error("Invalid execution slice");
    const start = this.processed;
    micros(until);
    if (until < this.now) throw new Error("Cannot reverse simulation time");
    while (this.heap[0] && this.heap[0].at <= until) {
      if (this.processed - start >= events) return false;
      const event = this.remove(0);
      this.now = event.at; this.processed++; event.run();
    }
    this.now = micros(until);
    return true;
  }
}

export type EventClock = Pick<EventKernel, "now" | "schedule">;

// UTF-8 length without allocating an encoded buffer or depending on host APIs.
// Lone surrogates use the three-byte replacement encoding, like JSON transport.
export function utf8Bytes(text: string) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}
