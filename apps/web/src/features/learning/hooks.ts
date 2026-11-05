import { useCallback, useEffect, useRef, useState } from "react";
import type { LearningLessonDetail } from "@infraforge/contracts/learning";
import type { RunReport } from "@infraforge/contracts/reports";
import { useRequest } from "@/api/useRequest";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { getLearningCatalog, getLearningLesson } from "./learning.api";
import { readDeviceLesson, saveDeviceLesson, type DeviceLessonState } from "./deviceLocal";
import { EMPTY_FILTERS, type LearningFilters } from "./discovery";
import { focusLearningHeading } from "./navigationFocus";
import { findReportLesson } from "./reportLessonData";
import { getLatestLessonReport, getLessonComparison } from "./lessonActivityData";

export function useLearningOwner() { return useAuthStore(s => s.user?.id); }
export function useLearningFilters() { return useState<LearningFilters>({ ...EMPTY_FILTERS }); }
export function useLearningFocus(destination: string) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => { focusLearningHeading(container.current); }, [destination]);
  return container;
}
export function useReportLesson(challengeId: string) {
  const load = useCallback(() => findReportLesson(challengeId), [challengeId]);
  return useRequest(load, "The lesson follow-up could not be loaded.");
}
export function useLessonComparison(report: RunReport) {
  const load = useCallback(() => getLessonComparison(report), [report]);
  return useRequest(load, "Eligible comparisons could not be loaded. No comparison is known.");
}
export function useLessonActivity(detail: LearningLessonDetail) {
  const load = useCallback(() => getLatestLessonReport(detail), [detail]);
  return useRequest(load, "Your recorded cues could not be loaded. No outcome is known.");
}

export function useLearningCatalog() {
  return useRequest(getLearningCatalog, "Learning could not be loaded. Try again.");
}
export function useLearningLesson(id: string) {
  const load = useCallback(() => getLearningLesson(id), [id]);
  return useRequest(load, "This lesson could not be loaded. It may be unavailable. Try again.");
}
// Mounted with a lesson/version key so local answers cannot leak into another lesson.
export function useDeviceLesson(id: string, version: number) {
  const [state, setState] = useState(() => readDeviceLesson(id, version));
  const update = (value: DeviceLessonState) => {
    const available = saveDeviceLesson(id, version, value);
    setState({ value, available });
  };
  return { ...state, update };
}
