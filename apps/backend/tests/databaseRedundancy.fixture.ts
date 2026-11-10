import { restoreSafeRedundancyV1 as d } from "../challenges/definitions/restore-safe-redundancy/v1";
import { REFERENCE, answers, attemptRow } from "./challengeHarness";

// Passing design is defined only in challengeHarness. The near miss changes its delay.
export function redundancyDesigns() {
  const slow = structuredClone(REFERENCE[d.id]!);
  slow.resources.find(r => r.id === "db")!.databaseReplication!.replicationDelayMs = 60000;
  return [d.starter!, REFERENCE[d.id]!, slow];
}
let fixture: {d: typeof d; designs: ReturnType<typeof redundancyDesigns>; rows: ReturnType<typeof attemptRow>[]} | undefined;
export function redundancyFixture() {
  if (!fixture) {
    const designs = redundancyDesigns();
    fixture = {d, designs, rows: designs.map(s => attemptRow(d, s, answers(d, {"overall-health": "healthy"})))};
  }
  return fixture;
}
