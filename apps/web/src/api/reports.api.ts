import type { RunHistory, RunReport, RunComparison, RunSummary, RerunOptions, RerunMode, RunFamily, WorkloadVariant } from "@infraforge/contracts/reports";
import type { Deployment } from "@infraforge/contracts/deployment";
import { API_URL, http } from "../client/httpClient";
import { requireRunCompatibility } from "@/features/model2Run/compatibility";

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
// A workload variant needs its own request: it names the one setting to change and cannot be created by accident.
export type PlainRerunMode = Exclude<RerunMode, "workload-variant">;
export async function createRerun(id: string, mode: PlainRerunMode, matchedStop: boolean, expectedInputHash?: string): Promise<Deployment> {
  await requireRunCompatibility();
  return (await http.post(`${API_URL}/deployments/${encodeURIComponent(id)}/reruns`, { mode, matchedStop, expectedInputHash })).data.createdDeployment;
}
export async function createWorkloadVariantRun(id: string, variant: WorkloadVariant, matchedStop: boolean, expectedInputHash: string): Promise<Deployment> {
  await requireRunCompatibility();
  return (await http.post(`${API_URL}/deployments/${encodeURIComponent(id)}/reruns`, { mode: "workload-variant", variant, matchedStop, expectedInputHash })).data.createdDeployment;
}
export async function getRunFamily(id: string): Promise<RunFamily> {
  return (await http.get(`${API_URL}/deployments/${encodeURIComponent(id)}/family`)).data.family;
}
