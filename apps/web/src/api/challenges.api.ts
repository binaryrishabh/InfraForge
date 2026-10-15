import type { ChallengeBrief, ChallengePrediction, ChallengePreflight, ChallengeSummary, LearningHistory, ImprovementSubmission } from "@infraforge/contracts/challenges";
import type { DesignChangeReview } from "@infraforge/contracts/reports";
import type { Infrastructure } from "@infraforge/contracts/infrastructure";
import type { Deployment } from "@infraforge/contracts/deployment";
import { API_URL, http } from "../client/httpClient";

const base = `${API_URL}/challenges`;
const path = (id: string) => `${base}/${encodeURIComponent(id)}`;

export async function listChallenges(): Promise<ChallengeSummary[]> {
  return (await http.get(base)).data.challenges;
}
export async function getLearningHistory(limit = 20, before?: string): Promise<LearningHistory> {
  return (await http.get(`${base}/attempt-history`, { params: { limit, ...(before ? { before } : {}) } })).data.history;
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
export async function challengePreflight(id: string, layout: object, version?: number): Promise<ChallengePreflight> {
  return (await http.post(`${path(id)}/preflight`, { layout }, { params: version ? { version } : undefined })).data.preflight;
}
// The server supplies the workload, seed, evaluation time and rules; only the design and prediction are sent.
export async function startChallengeAttempt(id: string, infrastructureId: string, prediction: ChallengePrediction, improvement?: ImprovementSubmission, version?: number): Promise<Deployment> {
  return (await http.post(`${path(id)}/attempts`, { infrastructureId, prediction, ...(improvement ? { improvement } : {}) }, { params: improvement ? { version } : undefined })).data.createdDeployment;
}
export async function openImprovementWorkspace(id: string, sourceRunId: string): Promise<Infrastructure> {
  return (await http.post(`${path(id)}/improvement-workspace`, { sourceRunId })).data.infrastructure;
}
export async function previewImprovement(id: string, sourceRunId: string, infrastructureId: string, layout: object): Promise<DesignChangeReview> {
  return (await http.post(`${path(id)}/improvement-preview`, { sourceRunId, infrastructureId, layout })).data.review;
}
