import type { ExperimentEvidenceSample } from "@infraforge/contracts/reports";

export function pressureSegments(points: ExperimentEvidenceSample[], id: string, field: "cpu" | "memory") {
  const segments: Array<Array<{ second: number; value: number }>> = [];
  let current: (typeof segments)[number] | null = null;
  for (const point of points) {
    const value = point.resources.find((r) => r.id === id)?.[field];
    if (value === undefined) { current = null; continue; }
    if (!current || current.at(-1)!.second + 1 !== point.simulatedSeconds) { current = []; segments.push(current); }
    current.push({ second: point.simulatedSeconds, value });
  }
  return segments;
}
