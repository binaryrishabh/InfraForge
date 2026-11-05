import type { LearningCatalog, LearningLessonDetail } from "@infraforge/contracts/learning";
import { API_URL, http } from "@/client/httpClient";

const base = `${API_URL}/learning`;
export async function getLearningCatalog(): Promise<LearningCatalog> {
  return (await http.get(base)).data;
}
export async function getLearningLesson(id: string): Promise<LearningLessonDetail> {
  return (await http.get(`${base}/lessons/${encodeURIComponent(id)}`)).data;
}
