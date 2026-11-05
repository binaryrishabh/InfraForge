import { z } from "zod";
import type { LearningContent, LearningLesson } from "@infraforge/contracts/learning";
import { latestChallenge } from "../challenges/registry";

export const CONTENT_LIMITS = {
  title: 80, summary: 240, paragraph: 600, problem: 2, explanation: 4,
  limitations: 4, prerequisites: 10, choices: 6, tracks: 20, modules: 20, lessons: 500,
} as const;

const text = (max: number) => z.string().min(1).max(max).refine((value) => value.trim().length > 0, "Text must not be blank");
const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64);
const availability = z.enum(["available", "draft"]);
const paragraphs = (min: number, max: number) => z.array(text(CONTENT_LIMITS.paragraph)).min(min).max(max);
const check = z.object({
  question: text(240), choices: z.array(z.object({ id, text: text(240) }).strict()).min(2).max(CONTENT_LIMITS.choices),
  correctChoiceId: id, explanation: text(CONTENT_LIMITS.paragraph),
}).strict();
const base = {
  id, contentVersion: z.number().int().min(1).max(10_000), trackId: id, moduleId: id,
  title: text(CONTENT_LIMITS.title), summary: text(CONTENT_LIMITS.summary),
  level: z.enum(["beginner", "intermediate", "advanced"]), availability,
  prerequisites: z.array(id).max(CONTENT_LIMITS.prerequisites),
  problem: paragraphs(1, CONTENT_LIMITS.problem), explanation: paragraphs(2, CONTENT_LIMITS.explanation),
  limitations: paragraphs(1, CONTENT_LIMITS.limitations),
};
const lesson = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("reading"), experiment: z.null(), check: check.nullable() }).strict(),
  z.object({ ...base, kind: z.literal("conceptual-exercise"), experiment: z.null(), check }).strict(),
  z.object({ ...base, kind: z.literal("executable-lab"), experiment: z.object({ challengeId: id, prediction: text(400).nullable() }).strict(), check: check.nullable() }).strict(),
]);
const track = z.object({
  id, title: text(CONTENT_LIMITS.title), summary: text(CONTENT_LIMITS.summary), availability,
  modules: z.array(z.object({
    id, title: text(CONTENT_LIMITS.title), summary: text(CONTENT_LIMITS.summary), availability,
    lessonIds: z.array(id).min(1).max(CONTENT_LIMITS.lessons),
  }).strict()).min(1).max(CONTENT_LIMITS.modules),
}).strict();
const content = z.object({
  tracks: z.array(track).min(1).max(CONTENT_LIMITS.tracks),
  lessons: z.array(lesson).min(1).max(CONTENT_LIMITS.lessons),
  archivedLessons: z.array(lesson).max(CONTENT_LIMITS.lessons).optional(),
}).strict();

// A small editorial guard, not a proof of truth or a language classifier.
export const SIMULATED_RESULT_PHRASES = [
  "the simulation shows", "the simulator shows", "the run proves", "the recorded run shows", "your run achieved",
] as const;

export type ChallengeLookup = (id: string) => { definition: { predictions: readonly unknown[] } } | null;

/** Returns all authoring errors. No engine run, database or learner state is involved. */
export function validateLearningContent(input: LearningContent, challenge: ChallengeLookup = latestChallenge): string[] {
  const parsed = content.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const { tracks, lessons, archivedLessons = [] } = parsed.data;
  const errors: string[] = [];
  const unique = (label: string, ids: string[]) => {
    if (new Set(ids).size !== ids.length) errors.push(`${label} must be unique`);
  };
  unique("track ids", tracks.map((t) => t.id));
  unique("lesson ids", lessons.map((l) => l.id));
  unique("lesson versions", [...lessons, ...archivedLessons].map((l) => `${l.id}@${l.contentVersion}`));
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const counts = new Map<string, number>();
  for (const t of tracks) {
    unique(`${t.id} module ids`, t.modules.map((m) => m.id));
    for (const m of t.modules) for (const lessonId of m.lessonIds) {
      counts.set(lessonId, (counts.get(lessonId) ?? 0) + 1);
      const l = byId.get(lessonId);
      if (!l) errors.push(`${t.id}/${m.id}: missing lesson ${lessonId}`);
      else if (l.trackId !== t.id || l.moduleId !== m.id) errors.push(`${l.id}: trackId/moduleId inconsistent with track.ts`);
    }
  }
  for (const l of lessons) {
    if (counts.get(l.id) !== 1) errors.push(`${l.id}: must occur in exactly one module`);
    const t = tracks.find((t) => t.id === l.trackId);
    if (!t?.modules.some((m) => m.id === l.moduleId)) errors.push(`${l.id}: unknown trackId/moduleId`);
  }
  for (const l of [...lessons, ...archivedLessons]) {
    unique(`${l.id} prerequisites`, l.prerequisites);
    for (const prerequisite of l.prerequisites) {
      const required = byId.get(prerequisite);
      if (!required) errors.push(`${l.id}: missing prerequisite ${prerequisite}`);
      else if (l.level === "beginner" && required.level === "advanced") errors.push(`${l.id}: beginner lesson requires advanced lesson ${prerequisite}`);
    }
    if (l.check) {
      unique(`${l.id} choice ids`, l.check.choices.map((c) => c.id));
      if (!l.check.choices.some((c) => c.id === l.check!.correctChoiceId)) errors.push(`${l.id}: invalid correctChoiceId`);
    }
    if (l.kind === "executable-lab") {
      const entry = challenge(l.experiment.challengeId);
      if (!entry) errors.push(`${l.id}: unknown challengeId ${l.experiment.challengeId}`);
      else if (!l.experiment.prediction && !entry.definition.predictions.length) errors.push(`${l.id}: needs prediction text or challenge predictions`);
    } else {
      const authoredText = [l.title, l.summary, ...l.problem, ...l.explanation, ...l.limitations,
        ...(l.check ? [l.check.question, l.check.explanation, ...l.check.choices.map((c) => c.text)] : [])].join(" ").toLowerCase().replace(/\s+/g, " ");
      if (SIMULATED_RESULT_PHRASES.some((phrase) => authoredText.includes(phrase))) errors.push(`${l.id}: non-executable lesson claims simulated results`);
    }
  }
  for (const old of archivedLessons) {
    const current = byId.get(old.id);
    if (!current || old.contentVersion >= current.contentVersion || old.availability !== "available") errors.push(`${old.id}: archive must be an older published version of a current lesson`);
    if (current && (old.trackId !== current.trackId || old.moduleId !== current.moduleId)) errors.push(`${old.id}: archived trackId/moduleId must remain resolvable`);
  }
  const checkCycles = (roots: LearningLesson[], lookup: Map<string, LearningLesson>) => {
    const done = new Set<string>(), active = new Set<string>();
    const visit = (l: LearningLesson) => {
      if (active.has(l.id)) { errors.push(`${l.id}: prerequisite cycle`); return; }
      if (done.has(l.id)) return;
      active.add(l.id);
      for (const id of l.prerequisites) { const required = lookup.get(id); if (required) visit(required); }
      active.delete(l.id);
      done.add(l.id);
    };
    roots.forEach(visit);
  };
  checkCycles(lessons, byId);
  // Explicit version lookups must also have a usable prerequisite graph.
  for (const old of archivedLessons) checkCycles([old], new Map([...byId, [old.id, old]]));
  return errors;
}
