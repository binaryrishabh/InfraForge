import { http, API_URL } from "@/client/httpClient";
import type { AuthoringRequest, AdmissionRequest, InternalDesign, Review, RunSummary, InternalReport, ReplayResult, Diagnostic } from "@infraforge/contracts/internal-model2";
import { isAxiosError } from "axios";
const base = `${API_URL}/internal/model2`;
export async function workspace(signal?: AbortSignal) { return (await http.get<{ designs: InternalDesign[] }>(`${base}/workspace`, { signal, timeout: 15000 })).data; }
export async function validateAuthoring(body: AuthoringRequest, signal?: AbortSignal) { return (await http.post<{ review: Review }>(`${base}/validate`, body, { signal, timeout: 20000 })).data.review; }
export async function admitInternal(body: AdmissionRequest, signal?: AbortSignal) { return (await http.post<{ id: string; created: boolean }>(`${base}/runs`, body, { signal, timeout: 20000 })).data; }
export async function internalRuns(signal?: AbortSignal) { return (await http.get<{ runs: RunSummary[] }>(`${base}/runs`, { signal, timeout: 15000 })).data.runs; }
export async function internalReport(id: string, signal?: AbortSignal) { return (await http.get<{ report: InternalReport }>(`${base}/runs/${encodeURIComponent(id)}/report`, { signal, timeout: 15000 })).data.report; }
export async function replayInternal(id: string, signal?: AbortSignal) { return (await http.get<{ replay: ReplayResult }>(`${base}/runs/${encodeURIComponent(id)}/replay`, { signal, timeout: 20000 })).data.replay; }
export async function cancelInternal(id: string, signal?: AbortSignal) { await http.post(`${base}/runs/${encodeURIComponent(id)}/cancel`, {}, { signal, timeout: 15000 }); }
export function internalError(error: unknown): { message: string; denied: boolean; definitive: boolean; diagnostics: Diagnostic[] } {
  if (!isAxiosError(error)) return { message: "The request could not be completed. Your edits are preserved.", denied: false, definitive: false, diagnostics: [] };
  const status = error.response?.status;
  return { message: status === 401 ? "Your session ended. Sign in again; no new run will be submitted automatically." : status === 404 ? "Internal workspace unavailable. It may not be granted to your account or the record is unavailable." : error.response?.data?.message || "Request outcome unavailable. Retry the same reviewed submission to avoid duplication.",
    denied: status === 401 || status === 404, definitive: status === 400 || status === 409 || status === 422, diagnostics: error.response?.data?.diagnostics ?? [] };
}
