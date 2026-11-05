export interface DeviceLessonState { read: boolean; answer: string | null }
export interface DeviceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const EMPTY_DEVICE_STATE: DeviceLessonState = { read: false, answer: null };
const keyFor = (id: string, version: number) => `infraforge:learning:${encodeURIComponent(id)}:v${version}`;

// Acquire localStorage inside the guard: browsers may throw even on property access.
export function readDeviceLesson(id: string, version: number, storage: () => DeviceStorage = () => localStorage): { value: DeviceLessonState; available: boolean } {
  try {
    const raw = storage().getItem(keyFor(id, version));
    if (!raw) return { value: { ...EMPTY_DEVICE_STATE }, available: true };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { value: { ...EMPTY_DEVICE_STATE }, available: true };
    return { value: { read: "read" in parsed && parsed.read === true, answer: "answer" in parsed && typeof parsed.answer === "string" ? parsed.answer : null }, available: true };
  } catch { return { value: { ...EMPTY_DEVICE_STATE }, available: false }; }
}

export function saveDeviceLesson(id: string, version: number, value: DeviceLessonState, storage: () => DeviceStorage = () => localStorage): boolean {
  try { storage().setItem(keyFor(id, version), JSON.stringify(value)); return true; }
  catch { return false; }
}
