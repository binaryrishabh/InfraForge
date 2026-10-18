import type { ChallengeBrief } from "@infraforge/contracts/challenges";

// The brief's starting design in one sentence, for the map's label and the facts list.
export function startingPoint(brief: ChallengeBrief) {
  if (!brief.starter?.resources.length) return "A blank sheet. You place every resource.";
  const counts = new Map<string, number>();
  for (const r of brief.starter.resources) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  return `An existing design: ${[...counts].map(([type, n]) => `${n} × ${type}`).join(", ")}, already connected.`;
}
