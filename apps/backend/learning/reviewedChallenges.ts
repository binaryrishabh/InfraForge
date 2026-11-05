/** Human-reviewed challenge identity for each published executable contentVersion.
 * Keep old records. A changed challenge needs a new reviewed contentVersion. */
export interface LearningChallengeReview { challengeId: string; version: number; hash: string }
export const REVIEWED_CHALLENGES: Readonly<Record<string, LearningChallengeReview>> = {
  "where-does-the-time-go@1": { challengeId: "where-does-the-time-go", version: 1, hash: "58174698cfd975ad0117a8cf029a13293c720115455140058090c0de9814b5e9" },
  "waiting-with-spare-cpu@1": { challengeId: "waiting-with-spare-cpu", version: 1, hash: "e4fec65bcf80c96d30f239f2c7d6d4d8e3bc9427220c0bf5b40d6c47e8777f37" },
  "one-bigger-or-two-smaller@1": { challengeId: "one-bigger-or-two-smaller", version: 1, hash: "48b7361f4daf5649bf8ea465c307df7b5567bf32254743206e8a6cd80da13a56" },
};
