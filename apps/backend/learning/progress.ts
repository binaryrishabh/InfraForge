import type { LearningLesson, LessonProgress } from "@infraforge/contracts/learning";
import { learningAttempt } from "../challenges/history";
import { latestChallenge } from "../challenges/registry";
import { classifyComparison } from "../comparison/classify";
import type { StoredRun } from "../reports/report";

export type LearningRun = StoredRun & { ownerId: string | null };
type Lab = Extract<LearningLesson, { kind: "executable-lab" }>;
type Attempt = ReturnType<typeof learningAttempt>;
const judged = (a: Attempt) => a.status === "met" || a.status === "not-met";
const order = (a: StoredRun, b: StoredRun) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** No storage or second judge: all verdicts come from the recorded attempt's report. */
export function deriveLessonProgress(ownerId: string, lessons: readonly LearningLesson[], rows: readonly LearningRun[]): LessonProgress[] {
  const mine = rows.filter((r) => r.ownerId === ownerId && r.challengeId).toSorted(order);
  const facts = new Map(mine.map((r) => [r.id, learningAttempt(r)]));
  // Several lessons may introduce the same challenge; derive that challenge only once.
  const byChallenge = new Map<string, Omit<LessonProgress, "lessonId">>();
  return lessons.filter((l): l is Lab => l.kind === "executable-lab" && l.availability === "available").map((lesson) => {
    const challengeId = lesson.experiment.challengeId;
    let progress = byChallenge.get(challengeId);
    if (!progress) {
      const attempts = mine.filter((r) => r.challengeId === challengeId);
      const current = latestChallenge(challengeId)?.definition.version ?? null;
      const evaluated = attempts.filter((r) => judged(facts.get(r.id)!));
      const comparisons = new Map<string, ReturnType<typeof classifyComparison>>();
      const comparison = (a: LearningRun, b: LearningRun) => {
        const key = JSON.stringify([a.id, b.id]);
        let result = comparisons.get(key);
        if (!result) { result = classifyComparison(a, b); comparisons.set(key, result); }
        return result;
      };
      let sameConditionsComparison = false;
      // Use the classifier's recorded challenge conditions, never a reconstructed condition key.
      for (let i = 0; i < attempts.length && !sameConditionsComparison; i++) {
        for (let j = i + 1; j < attempts.length; j++) {
          const result = comparison(attempts[i]!, attempts[j]!);
          if (result.available && result.challengeConditions === "same") { sameConditionsComparison = true; break; }
        }
      }
      let improvement: LessonProgress["improvement"] = null;
      for (const row of evaluated) {
        const source = evaluated.find((r) => r.id === row.improvementSourceId);
        if (!source || order(source, row) >= 0 || row.learningIntent !== "improvement" || !row.learningHypothesis?.trim()) continue;
        const before = facts.get(source.id)!, after = facts.get(row.id)!;
        const result = comparison(source, row);
        if (result.available && result.challengeConditions === "same" && after.total === before.total && after.metCount > before.metCount) {
          improvement = { sourceRunId: source.id, runId: row.id };
        }
      }
      const met = evaluated.some((r) => r.challengeVersion === current && facts.get(r.id)!.status === "met");
      const earlier = (r: LearningRun) => current !== null && (r.challengeVersion ?? 0) > 0 && r.challengeVersion! < current;
      const last = attempts.at(-1);
      progress = {
        challengeId, currentChallengeVersion: current,
        activity: met ? "requirements-met" : improvement ? "improved-after-attempt" : attempts.length ? "attempted" : "not-started",
        attempts: attempts.length,
        predictionReviewed: evaluated.some((r) => !!r.predictionSubmittedAt && facts.get(r.id)!.predictionTotal > 0),
        sameConditionsComparison, lastRunId: last?.id ?? null, lastAttemptAt: last?.createdAt.toISOString() ?? null,
        lastActivityAt: attempts.length ? new Date(attempts.reduce((latest, r) => Math.max(latest, r.updatedAt.getTime()), -Infinity)).toISOString() : null,
        fromEarlierVersion: attempts.some(earlier),
        earlierVersionRequirementsMet: evaluated.some((r) => earlier(r) && facts.get(r.id)!.status === "met"),
        improvement,
      };
      byChallenge.set(challengeId, progress);
    }
    return { lessonId: lesson.id, ...progress };
  });
}

