import type { RunHistory, RunReport, RunComparison, RunSummary, RerunOptions, RerunMode, RunFamily } from "@infraforge/contracts/reports";
import type { Deployment } from "@infraforge/contracts/deployment";
import { API_URL, http } from "../client/httpClient";

export type RunKind = "all" | "challenge" | "freeform";
export async function getRunHistory(limit = 50, before?: string, kind: RunKind = "all"): Promise<RunHistory> {
  const response = await http.get(`${API_URL}/deployments/history`, { params: { limit, kind, ...(before ? { before } : {}) } });
  return { runs: response.data.runs, nextCursor: response.data.nextCursor };
}

export async function getRunReport(id: string): Promise<RunReport> {
  const response = await http.get(`${API_URL}/deployments/${encodeURIComponent(id)}/report`);
  return response.data.report;
}

export async function getComparison(a: string, b: string): Promise<RunComparison> {
  return (await http.get(`${API_URL}/deployments/compare`, { params: { a, b } })).data.comparison;
}
export async function getCompareOptions(id: string): Promise<RunSummary[]> {
  return (await http.get(`${API_URL}/deployments/${encodeURIComponent(id)}/compare-options`)).data.runs;
}
export async function getRerunOptions(id: string): Promise<RerunOptions> {
  return (await http.get(`${API_URL}/deployments/${encodeURIComponent(id)}/rerun-options`)).data.options;
}
export async function previewCanvasRerun(id: string, layout: object): Promise<RerunOptions> {
  return (await http.post(`${API_URL}/deployments/${id}/rerun-preview`, { layout })).data.options;
}
export async function createRerun(id: string, mode: RerunMode, matchedStop: boolean, expectedInputHash?: string): Promise<Deployment> {
  return (await http.post(`${API_URL}/deployments/${encodeURIComponent(id)}/reruns`, { mode, matchedStop, expectedInputHash })).data.createdDeployment;
}
export async function getRunFamily(id: string): Promise<RunFamily> {
  return (await http.get(`${API_URL}/deployments/${encodeURIComponent(id)}/family`)).data.family;
}
