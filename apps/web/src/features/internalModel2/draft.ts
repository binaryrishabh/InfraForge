import { authoringGroups } from "@infraforge/contracts/internal-model2";
import type { AuthoringDraft, Review } from "@infraforge/contracts/internal-model2";
export const blankDraft = (): AuthoringDraft => ({ schema: "infraforge-authoring/1", origin: "", values: Object.fromEntries(authoringGroups.flatMap((g) => g.fields.map((f) => [f.key, ""]))), vmAddress: "", objectAddress: "", callerAddress: "", zone: "", security: "", commands: [], crash: false, crashAt: "", crashDuration: "", restart: "" });
export { educationalExample } from "@infraforge/contracts/internal-model2/example";
export interface SavedDraft { design: string; draft: AuthoringDraft; review: Review | null; pending: boolean; lastRun: string }
const key = (owner: string) => `infraforge-model2-authoring/1:${owner}`;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every((name) => typeof value[name] === "string");
function validStored(value: unknown): value is SavedDraft {
  if (!record(value) || !strings(value, ["design", "lastRun"]) || typeof value.pending !== "boolean" || !record(value.draft)) return false;
  const draft = value.draft;
  if (draft.schema !== "infraforge-authoring/1" || !strings(draft, ["origin", "vmAddress", "objectAddress", "callerAddress", "zone", "security", "crashAt", "crashDuration", "restart"]) || typeof draft.crash !== "boolean" || !record(draft.values)) return false;
  if (!authoringGroups.every((group) => group.fields.every((field) => typeof (draft.values as Record<string, unknown>)[field.key] === "string")) || !Object.values(draft.values).every((entry) => typeof entry === "string")) return false;
  if (!Array.isArray(draft.commands) || draft.commands.length > 16 || !draft.commands.every((command: unknown) => record(command) && strings(command, ["at", "kind", "namespace", "key", "bytes", "content"]) && ["put", "get", "head", "delete"].includes(String(command.kind)))) return false;
  if (value.review === null) return !value.pending;
  const review = value.review;
  return record(review) && strings(review, ["requestHash", "revision", "designName"]) && typeof review.arrivals === "number" &&
    record(review.request) && strings(review.request, ["infrastructureId", "expectedDesignUpdatedAt", "idempotencyKey"]) && record(review.request.contract) && record(review.request.workload) &&
    Array.isArray(review.assumptions) && review.assumptions.every((entry) => typeof entry === "string") && Array.isArray(review.fields) &&
    review.fields.every((field: unknown) => record(field) && strings(field, ["field", "unit", "origin"]) && typeof field.value === "number");
}
export function readDraft(owner: string): SavedDraft {
  const empty: SavedDraft = { design: "", draft: blankDraft(), review: null, pending: false, lastRun: "" };
  try { const text = sessionStorage.getItem(key(owner)); if (!text || text.length > 262144) return empty;
    const stored: unknown = JSON.parse(text);
    if (!validStored(stored)) return empty;
    return stored;
  } catch { return empty; }
}
export function saveDraft(owner: string, value: SavedDraft) {
  try { const text = JSON.stringify(value); if (text.length > 262144) return false; sessionStorage.setItem(key(owner), text); return true; } catch { return false; }
}
