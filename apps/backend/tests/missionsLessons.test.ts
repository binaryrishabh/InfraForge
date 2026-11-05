import { expect, test } from "bun:test";
import { tracks, lessons as registered } from "../learning/content";
import { track, lessons } from "../learning/content/missions";
import { firstApplications } from "../learning/content/missions/first-applications";
import { latestChallenge } from "../challenges/registry";
import { REFERENCE } from "./challengeHarness";

test("missions register two calibrated labs with existing cross-resource prerequisites and explicit verification limits", () => {
  expect(tracks.filter(t => t.id === "missions")).toEqual([track]); expect(track.availability).toBe("available");
  expect(track.modules).toEqual([firstApplications]); expect(firstApplications.availability).toBe("available");
  expect(registered.filter(l => l.trackId === "missions")).toEqual(lessons); expect(lessons).toHaveLength(2);
  expect(firstApplications.lessonIds).toEqual(lessons.map(l => l.id));
  expect(new Set(registered.map(l => l.id)).size).toBe(registered.length);
  for (const lesson of lessons) {
    expect(lesson).toMatchObject({trackId: "missions", moduleId: "first-applications", contentVersion: 1, kind: "executable-lab", availability: "available"});
    expect(lesson.prerequisites.length).toBeGreaterThanOrEqual(2);
    expect(lesson.prerequisites.every(id => registered.some(l => l.id === id && l.trackId !== "missions"))).toBe(true);
    expect(lesson.limitations.length).toBeGreaterThan(2); expect(lesson.limitations.every(t => t.trim().length > 0)).toBe(true);
    expect(lesson.experiment!.prediction.trim().length).toBeGreaterThan(0); expect(lesson.experiment!.evidenceToInspect.length).toBeGreaterThan(1);
    expect(lesson.followUp.trim().length).toBeGreaterThan(0);
    const d = latestChallenge(lesson.experiment!.challengeId)!.definition;
    expect(d.engine).toBe("2"); expect(d.version).toBe(1); expect(d.hints).toHaveLength(3); expect(REFERENCE[d.id]).toBeDefined();
    expect(lesson.check!.choices.some(c => c.id === lesson.check!.correctChoiceId)).toBe(true);
  }
  expect(lessons[0]!.limitations.join(" ")).toContain("unique-ID");
  expect(lessons[0]!.limitations.join(" ")).toContain("key-value");
  for (const term of ["Payments", "stock guarantees", "distributed transactions"]) expect(lessons[1]!.limitations.join(" ")).toContain(term);
});
