import { expect, test } from "bun:test";
import { learningContent } from "../learning/content";

test("architecture and diagnosis level by kind inventory counts current registered lessons", () => {
  for (const track of ["architecture", "diagnosis"]) {
    const lessons = learningContent.lessons.filter(l => l.trackId === track);
    expect(lessons.every(l => l.availability === "available")).toBe(true);
    const counts = ["beginner", "intermediate", "advanced"].map(level => [level,
      ...["reading", "conceptual-exercise", "executable-lab"].map(kind =>
        lessons.filter(l => l.level === level && l.kind === kind).length)]);
    expect(counts.reduce((sum, row) => sum + (row.slice(1) as number[]).reduce((a, b) => a + b, 0), 0)).toBe(lessons.length);
    console.info(JSON.stringify({track, columns: ["level", "reading", "conceptual-exercise", "executable-lab"], counts}));
  }
});
