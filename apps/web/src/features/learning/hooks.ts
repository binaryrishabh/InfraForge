import { useCallback, useState } from "react";
import { useRequest } from "@/api/useRequest";
import { getLearningCatalog, getLearningLesson } from "./learning.api";
import { readDeviceLesson, saveDeviceLesson, type DeviceLessonState } from "./deviceLocal";

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
