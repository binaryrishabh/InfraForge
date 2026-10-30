import type { InterventionReceipt } from "@infraforge/contracts/actions";
import { utf8Bytes } from "../time";

// The stored action outcome must stay under 32 KiB (Postgres jsonb text), so a receipt is kept under this serialized size.
export const RECEIPT_BYTES = 24 * 1024;
const size = (value: unknown) => utf8Bytes(JSON.stringify(value));

/** Keep the first IDs (they are sorted) of each list until the receipt fits, and say how many there really were. */
export function capReceipt(receipt: InterventionReceipt): InterventionReceipt {
  if (size(receipt) <= RECEIPT_BYTES) return receipt;
  const build = (keep: number): InterventionReceipt => ({ ...receipt, resolvedTargets: receipt.resolvedTargets.slice(0, keep), affectedPaths: receipt.affectedPaths.slice(0, keep),
    resolvedTargetCount: receipt.resolvedTargets.length, affectedPathCount: receipt.affectedPaths.length });
  let keep = Math.max(receipt.resolvedTargets.length, receipt.affectedPaths.length);
  while (keep > 1 && size(build(keep)) > RECEIPT_BYTES) keep = Math.floor(keep / 2);
  return build(keep);
}
