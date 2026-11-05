import { expect, test } from "bun:test";
import { tracks, lessons as registered } from "../learning/content";
import { track, lessons } from "../learning/content/failures";
import { incidentEvidence } from "../learning/content/failures/incident-evidence";
import { latestChallenge } from "../challenges/registry";
import { REFERENCE } from "./challengeHarness";

test("failures registers three executable lessons with calibrated experiments and evidence limitations", () => {
  expect(tracks.filter(t => t.id === "failures")).toEqual([track]); expect(track.availability).toBe("available");
  expect(track.modules).toEqual([incidentEvidence]); expect(incidentEvidence.availability).toBe("available");
  expect(registered.filter(l => l.trackId === "failures")).toEqual(lessons);
  const labs = lessons.filter(lesson => lesson.kind === "executable-lab");
  expect(labs).toHaveLength(3);
  expect(incidentEvidence.lessonIds).toEqual(lessons.map(l => l.id)); expect(new Set(registered.map(l => l.id)).size).toBe(registered.length);
  for (const lesson of labs) {
    expect(lesson).toMatchObject({trackId: "failures", moduleId: "incident-evidence", contentVersion: 1, kind: "executable-lab", availability: "available"});
    expect(lesson.prerequisites.every(id => registered.some(l => l.id === id))).toBe(true);
    expect(lesson.limitations.length).toBeGreaterThan(1); expect(lesson.limitations.every(t => t.trim().length > 0)).toBe(true);
    expect(lesson.followUp.trim().length).toBeGreaterThan(0); expect(lesson.experiment!.prediction.trim().length).toBeGreaterThan(0);
    expect(lesson.experiment!.evidenceToInspect.length).toBeGreaterThan(1);
    const d = latestChallenge(lesson.experiment!.challengeId)!.definition;
    expect(d.engine).toBe("2"); expect(d.version).toBe(1); expect(d.hints).toHaveLength(3); expect(REFERENCE[d.id]).toBeDefined();
    expect(lesson.check!.choices.some(c => c.id === lesson.check!.correctChoiceId)).toBe(true);
  }
});
