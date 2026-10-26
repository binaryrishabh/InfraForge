import { http, API_URL } from "@/client/httpClient";
import type { LessonChoice, LessonReview, LessonSubmission, LessonWorkspace } from "@infraforge/contracts/internal-lessons";
const base = `${API_URL}/internal/model2`;
export async function capability(signal?: AbortSignal) {
  const response = await http.get<{ scope: "operator" | "lesson" }>(`${base}/capability`, {
    signal, timeout: 15000, validateStatus: (status) => status === 404 || (status >= 200 && status < 300),
  });
  return response.status === 404 ? null : response.data;
}
export async function lessonWorkspace(signal?: AbortSignal) { return (await http.get<{ workspace: LessonWorkspace }>(`${base}/lesson`, { signal, timeout: 15000 })).data.workspace; }
export async function createLessonDesign(signal?: AbortSignal) { return (await http.post<{ id: string }>(`${base}/lesson/design`, {}, { signal, timeout: 15000 })).data.id; }
export async function reviewLesson(body: LessonChoice, signal?: AbortSignal) { return (await http.post<{ lesson: LessonReview }>(`${base}/lesson/review`, body, { signal, timeout: 20000 })).data.lesson; }
export async function submitLesson(body: LessonSubmission, signal?: AbortSignal) { return (await http.post<{ id: string; created: boolean }>(`${base}/lesson/runs`, body, { signal, timeout: 20000 })).data; }
