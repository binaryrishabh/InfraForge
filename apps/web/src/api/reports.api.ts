import type { RunHistory, RunReport, RunComparison, RunSummary } from "@infraforge/contracts/reports";
import { API_URL, http } from "../client/httpClient";

export async function getRunHistory(limit = 50, before?: string): Promise<RunHistory> {
  const response = await http.get(`${API_URL}/deployments/history`, { params: { limit, ...(before ? { before } : {}) } });
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
