import type { ChallengeSummary } from "@infraforge/contracts/challenges";
import type { Infrastructure } from "@infraforge/contracts/infrastructure";
import type { RunSummary } from "@infraforge/contracts/reports";
import type { LiveDeploymentSummary } from "@/api/deployment.api";
import type { LearningCatalog, LearningLessonSummary } from "@infraforge/contracts/learning";
import { availableLessons } from "@/features/learning/discovery";

/* Home's single recommendation, in priority order: a live run, a challenge whose
latest attempt fell short, a challenge in progress, an untried challenge. */
export interface HomeData { live: LiveDeploymentSummary[]; challenges: ChallengeSummary[]; runs: RunSummary[]; designs: Infrastructure[] }

export type Next =
  | { kind: "live"; run: LiveDeploymentSummary }
  | { kind: "improve" | "continue" | "start"; challenge: ChallengeSummary }
  | { kind: "free" };

export function nextStep(data: HomeData): Next {
  if (data.live[0]) return { kind: "live", run: data.live[0] };
  const failed = data.challenges.find((c) => !c.met && c.latest && c.latest.status !== "in-progress");
  if (failed) return { kind: "improve", challenge: failed };
  const started = data.challenges.find((c) => !c.met && c.workspaceDesignId);
  if (started) return { kind: "continue", challenge: started };
  const fresh = data.challenges.find((c) => c.attempts === 0);
  return fresh ? { kind: "start", challenge: fresh } : { kind: "free" };
}

// Learning is an additional recommendation; the existing live > improve >
// continue-design > fresh-challenge > free-design priority above stays intact.
// Within learning, prefer the server's continue suggestion, then its nextLesson.
export function learningNextStep(catalog: LearningCatalog | null): { lesson: LearningLessonSummary; reason: string } | null {
  if (!catalog) return null;
  const visible = new Map(availableLessons(catalog).map((l) => [l.id, l]));
  for (const suggestion of [catalog.suggestions.continue, catalog.suggestions.nextLesson]) {
    if (!suggestion?.reason.trim()) continue;
    const lesson = visible.get(suggestion.lessonId);
    if (lesson) return { lesson, reason: suggestion.reason };
  }
  return null;
}
