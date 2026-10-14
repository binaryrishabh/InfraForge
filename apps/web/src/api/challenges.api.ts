import type { ChallengeBrief, ChallengePrediction, ChallengePreflight, ChallengeSummary } from "@infraforge/contracts/challenges";
import type { Deployment } from "@infraforge/contracts/deployment";
import { API_URL, http } from "../client/httpClient";

const base = `${API_URL}/challenges`;
const path = (id: string) => `${base}/${encodeURIComponent(id)}`;

export async function listChallenges(): Promise<ChallengeSummary[]> {
  return (await http.get(base)).data.challenges;
}
// The latest version, or an exact earlier version for reading what a past attempt was judged by.
export async function getChallenge(id: string, version?: number): Promise<ChallengeBrief> {
  return (await http.get(path(id), { params: version ? { version } : undefined })).data.challenge;
}
/* Returns the learner's workspace for the latest version, or creates one: from the
starter, or (only when asked) as a copy of an earlier version's workspace. */
export async function openChallengeWorkspace(id: string, options: { fresh?: boolean; copyFrom?: string } = {}): Promise<{ designId: string; created: boolean }> {
  const data = (await http.post(`${path(id)}/workspace`, { fresh: options.fresh ?? false, ...(options.copyFrom ? { copyFrom: options.copyFrom } : {}) })).data;
  return { designId: data.designId, created: data.created };
}
export async function challengePreflight(id: string, layout: object): Promise<ChallengePreflight> {
  return (await http.post(`${path(id)}/preflight`, { layout })).data.preflight;
}
// The server supplies the workload, seed, evaluation time and rules; only the design and prediction are sent.
export async function startChallengeAttempt(id: string, infrastructureId: string, prediction: ChallengePrediction): Promise<Deployment> {
  return (await http.post(`${path(id)}/attempts`, { infrastructureId, prediction })).data.createdDeployment;
}
