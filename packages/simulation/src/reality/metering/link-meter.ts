import type { UsageDetail, UsageSource } from "./contracts";
import type { LinkMeasurement, TransferCounts } from "./measurements";
import { count, text } from "./validation";

const counters = () => ({ offeredBytes: 0n, acceptedBytes: 0n, rejectedBytes: 0n, deliveredBytes: 0n, failedBytes: 0n, liveBytes: 0n, offeredTransfers: 0n, terminalTransfers: 0n, liveTransfers: 0n });
type Counters = ReturnType<typeof counters>;
const serialized = (c: Counters): TransferCounts => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)])) as TransferCounts;
type Direction = "request" | "response" | "unattributed";
export class LinkMeter {
  private totals = counters();
  private directions = { request: counters(), response: counters(), unattributed: counters() };
  private live = new Map<number, { bytes: bigint; accepted: boolean; direction: Direction }>();
  constructor(readonly source: Extract<UsageSource, { family: "link" }>) {}
  apply(detail: UsageDetail) {
    if (detail.kind === "transfer-start") {
      if (count(detail.transfer) !== this.totals.offeredTransfers + 1n || this.live.has(detail.transfer) || typeof detail.accepted !== "boolean") throw Error("Transfer identity sequence gap/duplicate");
      text(detail.id); const bytes = count(detail.bytes), context = detail.context;
      let direction: Direction = "unattributed";
      if (context !== null) {
        if (!["request", "response"].includes(context.direction)) throw Error("Unknown transfer direction");
        text(context.path, 160); text(context.origin, 160); text(context.destination, 160); text(context.callId); text(context.rootId); count(context.hop);
        if (count(context.attempt) < 1n) throw Error("Missing transfer attempt identity");
        direction = context.direction;
      }
      this.live.set(detail.transfer, { bytes, accepted: detail.accepted, direction });
      for (const c of [this.totals, this.directions[direction]]) {
        c.offeredTransfers++; c.liveTransfers++; c.offeredBytes += bytes;
        if (detail.accepted) { c.acceptedBytes += bytes; c.liveBytes += bytes; } else c.rejectedBytes += bytes;
      }
      return;
    }
    if (detail.kind !== "transfer-end") throw Error("Wrong transfer usage dimension");
    const transfer = this.live.get(detail.transfer);
    if (!transfer || !["delivered", "unreachable", "overflow", "aborted"].includes(detail.outcome) || !transfer.accepted && !["unreachable", "overflow"].includes(detail.outcome) || transfer.accepted && detail.outcome === "overflow") throw Error("Transfer terminal has no matching admission");
    this.live.delete(detail.transfer);
    for (const c of [this.totals, this.directions[transfer.direction]]) {
      c.terminalTransfers++; c.liveTransfers--;
      if (transfer.accepted) {
        c.liveBytes -= transfer.bytes;
        if (detail.outcome === "delivered") c.deliveredBytes += transfer.bytes; else c.failedBytes += transfer.bytes;
      }
    }
  }
  snapshot(): LinkMeasurement {
    return { family: "link", resource: this.source.resource, from: this.source.from, to: this.source.to, totals: serialized(this.totals),
      directions: { request: serialized(this.directions.request), response: serialized(this.directions.response), unattributed: serialized(this.directions.unattributed) }, providerBillableTransfer: "Unknown" };
  }
}
