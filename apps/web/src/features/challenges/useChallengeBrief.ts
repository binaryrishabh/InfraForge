import { useCallback } from "react";
import { getChallenge } from "@/api/challenges.api";
import { useRequest } from "@/api/useRequest";

const noop = async () => null;

// Loads the brief for a challenge (or nothing): the latest version, or the exact version a run recorded.
export function useChallengeBrief(challengeId: string | null, version?: number | null) {
  const load = useCallback(() => (challengeId ? getChallenge(challengeId, version ?? undefined) : noop()), [challengeId, version]);
  const request = useRequest(load, "The challenge brief could not be loaded.");
  return challengeId ? request : null;
}
