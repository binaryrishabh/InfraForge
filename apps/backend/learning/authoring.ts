import type { LearningContent } from "@infraforge/contracts/learning";
import { findChallenge, latestChallenge, type ChallengeRegistry } from "../challenges/registry";
import { validateLearningContent } from "./validate";
import { REVIEWED_CHALLENGES, type LearningChallengeReview } from "./reviewedChallenges";
import { checkLessonClaims } from "./claims";

/** Authoring gate only: archived text stays tied to its reviewed published rules;
 * current labs must also have been reviewed against the latest challenge. */
export function checkLearningAuthoring(content: LearningContent,
  reviews: Readonly<Record<string, LearningChallengeReview>> = REVIEWED_CHALLENGES,
  challenges: Pick<ChallengeRegistry, "latest" | "find"> = { latest: latestChallenge, find: findChallenge }) {
  const errors = validateLearningContent(content, challenges.latest);
  if (!errors.length) for (const lesson of [...content.lessons, ...(content.archivedLessons ?? [])]) {
    if (lesson.kind !== "executable-lab") { errors.push(...checkLessonClaims(lesson)); continue; }
    const identity = `${lesson.id}@${lesson.contentVersion}`, review = reviews[identity];
    if (!review || review.challengeId !== lesson.experiment.challengeId) {
      errors.push(`${identity}: missing challenge review; needs a human look`);
      continue;
    }
    const pinned = challenges.find(review.challengeId, review.version);
    if (!pinned || pinned.hash !== review.hash) errors.push(`${identity}: reviewed challenge identity is unavailable or changed; needs a human look`);
    else errors.push(...checkLessonClaims(lesson, pinned.definition));
    if (content.lessons.includes(lesson)) {
      const latest = challenges.latest(lesson.experiment.challengeId);
      if (latest && (latest.definition.version !== review.version || latest.hash !== review.hash)) {
        errors.push(`${identity}: challenge ${review.challengeId} moved since contentVersion (reviewed v${review.version}, latest v${latest.definition.version}); needs a human look and a newly reviewed contentVersion`);
      }
    }
  }
  if (errors.length) throw new Error(`Invalid learning authoring:\n${errors.join("\n")}`);
  return { tracks: content.tracks.length, lessons: content.lessons.length,
    labs: content.lessons.filter((l) => l.kind === "executable-lab").length, archived: content.archivedLessons?.length ?? 0 };
}
