import { useCallback } from "react";
import { getChallenge } from "@/api/challenges.api";
import { useRequest } from "@/api/useRequest";

const noop = async () => null;

// Loads the brief for the challenge the open design belongs to (or nothing).
export function useChallengeBrief(challengeId: string | null) {
  const load = useCallback(() => (challengeId ? getChallenge(challengeId) : noop()), [challengeId]);
  const request = useRequest(load, "The challenge brief could not be loaded.");
  return challengeId ? request : null;
}
