import type { Rational } from "./contracts";
import { add, compare, fraction, fromNumber, multiply, subtract } from "./exact";
export function occupancy(initialBytes: string, changes: Array<{
  id: string;

  atUs: number;

  bytes: string
}>, fromUs: number, toUs: number): Rational {
  fromNumber(fromUs);

  fromNumber(toUs);

  if (toUs < fromUs || changes.length > 10000 || new Set(changes.map((c) => c.id)).size !== changes.length) throw Error("Invalid occupancy window/mutation identities/budget");

  let bytes = fraction(initialBytes), last = 0, cursor = fromUs, area = fraction(0n);

  for (const c of changes) {
    fromNumber(c.atUs);

    if (!c.id || c.atUs < last || c.atUs > toUs) throw Error("Complete ordered mutation boundaries required");

    const end = Math.max(fromUs, c.atUs);

    area = add(area, multiply(bytes, fromNumber(end - cursor)));

    cursor = end;

    bytes = fraction(c.bytes);

    last = c.atUs;
  }

  return add(area, multiply(bytes, fromNumber(toUs - cursor)));
}
export function counterDelta(before: {
  epoch: string;

  value: string
}, after: {
  epoch: string;

  value: string
}) {
  const a = fraction(before.value), b = fraction(after.value);

  return !before.epoch || before.epoch !== after.epoch || compare(b, a) < 0 ? { kind: "Unknown" as const, reason: "Counter epoch/reset or decrease" } : { kind: "Observed" as const, quantity: subtract(b, a) };
}
