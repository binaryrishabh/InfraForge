import { expect, test } from "bun:test";
import { tracks, lessons as registered } from "../learning/content";
import { track, lessons } from "../learning/content/missions";
import { backgroundServices, backgroundServiceLessons } from "../learning/content/missions/background-services";
import { firstApplications, firstApplicationLessons } from "../learning/content/missions/first-applications";
import { guidedMissions, guidedMissionLessons } from "../learning/content/missions/guided-missions";
import { latestChallenge } from "../challenges/registry";
import { REFERENCE } from "./challengeHarness";

test("missions retain four advanced labs and add an intermediate guided module with existing prerequisites", () => {
  expect(tracks.filter(t => t.id === "missions")).toEqual([track]); expect(track.availability).toBe("available");
  expect(track.modules).toEqual([guidedMissions, firstApplications, backgroundServices]); expect(firstApplications.availability).toBe("available"); expect(backgroundServices.availability).toBe("available");
  expect(registered.filter(l => l.trackId === "missions")).toEqual(lessons); expect(lessons).toHaveLength(5);
  expect(firstApplications.lessonIds).toEqual(firstApplicationLessons.map(l => l.id)); expect(backgroundServices.lessonIds).toEqual(backgroundServiceLessons.map(l => l.id));
  expect(new Set(registered.map(l => l.id)).size).toBe(registered.length);
  for (const lesson of lessons) {
    expect(lesson).toMatchObject({trackId: "missions", moduleId: track.modules.find(m => m.lessonIds.includes(lesson.id))!.id, contentVersion: 1, kind: "executable-lab", availability: "available"});
    expect(lesson.prerequisites.length).toBeGreaterThanOrEqual(2);
    expect(lesson.prerequisites.every(id => registered.some(l => l.id === id && l.trackId !== "missions"))).toBe(true);
    expect(lesson.limitations.length).toBeGreaterThan(2); expect(lesson.limitations.every(t => t.trim().length > 0)).toBe(true);
    expect((lesson.experiment?.prediction?.trim().length ?? 0)).toBeGreaterThan(0); expect((lesson.experiment?.evidenceToInspect?.length ?? 0)).toBeGreaterThan(1);
    expect((lesson.followUp?.trim().length ?? 0)).toBeGreaterThan(0);
    const d = latestChallenge(lesson.experiment!.challengeId)!.definition;
    expect(d.engine).toBe("2"); expect(d.version).toBe(1); expect(d.hints).toHaveLength(3); expect(REFERENCE[d.id]).toBeDefined();
    expect(lesson.check!.choices.some(c => c.id === lesson.check!.correctChoiceId)).toBe(true);
  }
  const advanced = [...firstApplicationLessons, ...backgroundServiceLessons];
  expect(advanced.every(l => l.level === "advanced")).toBe(true);
  expect(advanced[0]!.limitations.join(" ")).toContain("unique-ID");
  expect(advanced[0]!.limitations.join(" ")).toContain("key-value");
  for (const term of ["Payments", "stock guarantees", "distributed transactions"]) expect(advanced[1]!.limitations.join(" ")).toContain(term);
  for (const term of ["Provider delivery", "ordering", "duplicate sends", "payments"]) expect(advanced[2]!.limitations.join(" ")).toContain(term);
  for (const term of ["No database write", "unique event IDs", "exactly-once"]) expect(advanced[3]!.limitations.join(" ")).toContain(term);
  expect(guidedMissions.lessonIds).toEqual(guidedMissionLessons.map(l => l.id));
  expect(guidedMissionLessons).toHaveLength(1);
  const guided = guidedMissionLessons[0]!;
  expect(guided).toMatchObject({level: "intermediate", prerequisites: ["firewall-rule-matching", "find-the-denying-rule", "where-does-the-time-go"]});
  expect(guided.followUp).toContain("catalogue-link-flash");
  expect(registered.find(l => l.id === "catalogue-link-flash")!.level).toBe("advanced");
  for (const prerequisite of ["find-the-denying-rule", "where-does-the-time-go"]) expect(registered.find(l => l.id === prerequisite)!.kind).toBe("executable-lab");
});
