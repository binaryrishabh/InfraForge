import type { EventClock } from "../time";

export interface IoDevice {
  id: string; generation: number; queueOperations: number; queueBytes: number;
  serviceConcurrency: 1; iops: number; bytesPerSecond: number; flushServiceUs: number;
  policy: "fifo-max-operation-byte-service/1";
}
export type IoClass = "page-read" | "wal-write" | "flush" | "background-write";
export interface IoWork { role: string; request: string; transaction: string; operation: string; kind: IoClass; bytes: number }
export interface IoReceipt extends IoWork {
  device: string; generation: number; state: "queued" | "servicing" | "completed" | "cancelled";
  queuedAtUs: number; startedAtUs: number | null; completedAtUs: number | null; detached: boolean;
}
export interface IoHandle { admitted: boolean; state(): IoReceipt["state"] | "rejected"; cancel(): boolean }

// One shared service lane. Rounding each demand up preserves both rate bounds.
// Completion priority 2 follows faults (0) and deadlines (1); FIFO starts are
// synchronous after completion. This clock belongs to the device, not a caller.
export function ioBudget(authored: IoDevice, clock: EventClock, maxReceipts: number) {
  const config = { ...authored };
  if (!config.id || !Number.isSafeInteger(config.generation) || config.generation < 0 || config.policy !== "fifo-max-operation-byte-service/1" || config.serviceConcurrency !== 1 ||
    ![config.queueOperations, config.queueBytes, maxReceipts].every(n => Number.isSafeInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER) ||
    !Number.isSafeInteger(config.queueBytes * maxReceipts) || ![config.iops, config.bytesPerSecond].every(n => Number.isFinite(n) && n > 0) || !Number.isSafeInteger(config.flushServiceUs) || config.flushServiceUs < 0) throw Error("Invalid finite IO device");
  const receipts: IoReceipt[] = [], queue = new Map<IoReceipt, { done: () => void; completeDetached: boolean }>();
  let live: IoReceipt | undefined, queuedBytes = 0, retired = false, rejected = 0;
  const pump = () => {
    if (live || !queue.size) return;
    const [receipt, completion] = queue.entries().next().value!;
    queue.delete(receipt); queuedBytes -= receipt.bytes; live = receipt;
    receipt.state = "servicing"; receipt.startedAtUs = clock.now;
    const demand = Math.ceil(Math.max(1_000_000 / config.iops, receipt.bytes * 1_000_000 / config.bytesPerSecond)) + (receipt.kind === "flush" ? config.flushServiceUs : 0);
    clock.schedule(clock.now + demand, 2, JSON.stringify(["io-complete", config.id, config.generation, receipts.indexOf(receipt)]), () => {
      receipt.state = "completed"; receipt.completedAtUs = clock.now; live = undefined;
      // Reserve service for older queued work before a completion creates more.
      pump(); if (!receipt.detached || completion.completeDetached) completion.done();
    });
  };
  return {
    submit(work: IoWork, done: () => void, completeDetached = false): IoHandle {
      if (retired) throw Error("Retired IO generation");
      if (![work.role, work.request, work.transaction, work.operation].every(id => typeof id === "string" && id.length > 0) || !["page-read", "wal-write", "flush", "background-write"].includes(work.kind) || !Number.isSafeInteger(work.bytes) || work.bytes < 0 ||
        !Number.isSafeInteger(clock.now + Math.ceil(Math.max(1_000_000 / config.iops, work.bytes * 1_000_000 / config.bytesPerSecond)) + config.flushServiceUs)) throw Error("Invalid IO work/time");
      if (receipts.length >= maxReceipts) throw Error("Executor IO receipt budget exhausted; evidence is incomplete");
      if (work.bytes > config.queueBytes || (live && (queue.size >= config.queueOperations || work.bytes > config.queueBytes - queuedBytes))) {
        rejected++; return { admitted: false, state: () => "rejected", cancel: () => false };
      }
      const receipt: IoReceipt = { ...work, device: config.id, generation: config.generation, state: "queued", queuedAtUs: clock.now, startedAtUs: null, completedAtUs: null, detached: false };
      receipts.push(receipt); queue.set(receipt, { done, completeDetached }); queuedBytes += work.bytes; pump();
      return { admitted: true, state: () => receipt.state, cancel() {
        if (receipt.state === "completed" || receipt.state === "cancelled" || receipt.detached) return false;
        receipt.detached = true;
        if (receipt.state === "queued") { queue.delete(receipt); queuedBytes -= receipt.bytes; receipt.state = "cancelled"; receipt.completedAtUs = clock.now; }
        return true;
      } };
    },
    retire() { if (live || queue.size) throw Error("IO generation still owns live work"); retired = true; },
    measure() {
      const ledger = (state?: IoReceipt["state"]) => {
        const xs = state ? receipts.filter(r => r.state === state) : receipts;
        return { operations: xs.length, bytes: xs.reduce((n, r) => n + r.bytes, 0) };
      };
      return { ...config, retired, rejected, accepted: ledger(), queued: ledger("queued"), servicing: ledger("servicing"), completed: ledger("completed"), cancelled: ledger("cancelled"),
        receipts: receipts.map(r => ({ ...r, queueUs: (r.startedAtUs ?? r.completedAtUs ?? clock.now) - r.queuedAtUs,
          serviceUs: r.startedAtUs === null ? 0 : (r.completedAtUs ?? clock.now) - r.startedAtUs })) };
    },
  };
}
