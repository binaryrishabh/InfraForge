import type { ChallengeBrief, ChallengePrediction, ChallengePreflight, ChallengeSummary } from "@infraforge/contracts/challenges";
import type { Deployment } from "@infraforge/contracts/deployment";
import { API_URL, http } from "../client/httpClient";

const base = `${API_URL}/challenges`;
const path = (id: string) => `${base}/${encodeURIComponent(id)}`;

export async function listChallenges(): Promise<ChallengeSummary[]> {
  return (await http.get(base)).data.challenges;
}
export async function getChallenge(id: string): Promise<ChallengeBrief> {
  return (await http.get(path(id))).data.challenge;
}
// Returns the learner's existing workspace for the challenge, or creates one from the starter.
export async function openChallengeWorkspace(id: string, fresh = false): Promise<{ designId: string; created: boolean }> {
  const data = (await http.post(`${path(id)}/workspace`, { fresh })).data;
  return { designId: data.designId, created: data.created };
}
export async function challengePreflight(id: string, layout: object): Promise<ChallengePreflight> {
  return (await http.post(`${path(id)}/preflight`, { layout })).data.preflight;
}
// The server supplies the workload, seed, evaluation time and rules; only the design and prediction are sent.
export async function startChallengeAttempt(id: string, infrastructureId: string, prediction: ChallengePrediction): Promise<Deployment> {
  return (await http.post(`${path(id)}/attempts`, { infrastructureId, prediction })).data.createdDeployment;
}
