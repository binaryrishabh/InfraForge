import type { RunHistory, RunReport } from "@infraforge/contracts/reports";
import { API_URL, http } from "../client/httpClient";

export async function getRunHistory(limit = 50, before?: string): Promise<RunHistory> {
  const response = await http.get(`${API_URL}/deployments/history`, { params: { limit, ...(before ? { before } : {}) } });
  return { runs: response.data.runs, nextCursor: response.data.nextCursor };
}

export async function getRunReport(id: string): Promise<RunReport> {
  const response = await http.get(`${API_URL}/deployments/${encodeURIComponent(id)}/report`);
  return response.data.report;
}
