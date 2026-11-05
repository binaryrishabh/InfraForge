// Isolated hook lifecycle seam: real learning hooks, useRequest and HTTP clients.
// No DOM or browser scheduling is claimed by this fixture.
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { mock } from "bun:test";
import { API_URL, http } from "../../src/client/httpClient";
import { attempted, catalog, concept, lab } from "../learningFixtures";
import type { LearningLessonDetail } from "@infraforge/contracts/learning";

interface Slot { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }
let slots: Slot[] = [], cursor = 0, effects: Array<() => void> = [];
const changed = (a: readonly unknown[] | undefined, b: readonly unknown[]) => !a || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
mock.module("react", () => ({
  useState: (initial: unknown) => {
    const index = cursor++;
    if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
    return [slots[index]!.value, (value: unknown) => { slots[index]!.value = typeof value === "function" ? value(slots[index]!.value) : value; }];
  },
  useRef: (initial: unknown) => {
    const index = cursor++;
    if (!slots[index]) slots[index] = { value: { current: initial } };
    return slots[index]!.value;
  },
  useCallback: (callback: unknown, deps: readonly unknown[]) => {
    const index = cursor++;
    if (changed(slots[index]?.deps, deps)) slots[index] = { value: callback, deps };
    return slots[index]!.value;
  },
  useEffect: (effect: () => (() => void) | undefined, deps: readonly unknown[]) => {
    const index = cursor++;
    if (changed(slots[index]?.deps, deps)) {
      const prior = slots[index]; slots[index] = { deps };
      effects.push(() => { prior?.cleanup?.(); slots[index]!.cleanup = effect(); });
    }
  },
}));
let owner: string | undefined = "alice";
mock.module("../../src/features/auth/store/auth.store", () => ({ useAuthStore: (select: (state: { user: { id: string } | null }) => unknown) => select({ user: owner ? { id: owner } : null }) }));
const hooks = await import("../../src/features/learning/hooks");
function render<T>(hook: () => T): T {
  cursor = 0;
  const result = hook();
  const queued = effects; effects = []; queued.forEach(effect => effect());
  return result;
}
function reset() { slots.forEach(slot => slot.cleanup?.()); slots = []; cursor = 0; effects = []; }
async function settle() { await setImmediate(); }

const requests: string[] = [];
const pending: Array<{ resolve(value: unknown): void; reject(error: Error): void }> = [];
http.defaults.adapter = config => {
  requests.push(config.url!);
  return new Promise((resolve, reject) => pending.push({
    resolve: data => resolve({ data, config, status: 200, statusText: "OK", headers: {} }), reject,
  }));
};

// Loading -> error -> retry -> ready, without a second load on a stable render.
let state = render(hooks.useLearningCatalog);
await settle();
assert.equal(state.loading, true); assert.equal(requests.at(-1), `${API_URL}/learning`);
pending.shift()!.reject(Error("Offline")); await settle();
state = render(hooks.useLearningCatalog);
assert.match(state.error!, /Learning could not be loaded/);
state.retry(); state = render(hooks.useLearningCatalog); assert.equal(state.loading, true);
await settle();
pending.shift()!.resolve(catalog); await settle();
state = render(hooks.useLearningCatalog); assert.deepEqual(state.data, catalog);
const count = requests.length; render(hooks.useLearningCatalog); assert.equal(requests.length, count);

// A new lesson request hides the previous detail and ignores its late response.
reset();
let lessonId = "old / lesson";
render(() => hooks.useLearningLesson(lessonId));
await settle();
const old = pending.shift()!;
assert.equal(requests.at(-1), `${API_URL}/learning/lessons/old%20%2F%20lesson`);
lessonId = concept.id;
assert.equal(render(() => hooks.useLearningLesson(lessonId)).loading, true);
await settle();
const current = pending.shift()!;
old.resolve({ lesson: lab }); await settle();
assert.equal(render(() => hooks.useLearningLesson(lessonId)).data, null);
const detail: LearningLessonDetail = { lesson: concept, progress: null, challenge: null };
current.resolve(detail); await settle();
assert.deepEqual(render(() => hooks.useLearningLesson(lessonId)).data, detail);

// Identity/version keyed mounts reset answers; write refusal retains visit state.
reset();
const values = new Map<string, string>();
let denied = false;
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { if (denied) throw Error("Denied"); values.set(key, value); },
} });
let device = render(() => hooks.useDeviceLesson(concept.id, 1));
device.update({ read: true, answer: "address" });
assert.equal(render(() => hooks.useDeviceLesson(concept.id, 1)).available, true);
reset(); assert.deepEqual(render(() => hooks.useDeviceLesson(concept.id, 1)).value, { read: true, answer: "address" });
reset(); assert.deepEqual(render(() => hooks.useDeviceLesson(concept.id, 2)).value, { read: false, answer: null });
denied = true; device = render(() => hooks.useDeviceLesson(concept.id, 2));
device.update({ read: true, answer: "note" }); device = render(() => hooks.useDeviceLesson(concept.id, 2));
assert.equal(device.available, false); assert.deepEqual(device.value, { read: true, answer: "note" });

reset();
const [filters, setFilters] = render(hooks.useLearningFilters);
setFilters({ ...filters, search: "dns" }); assert.equal(render(hooks.useLearningFilters)[0].search, "dns");
assert.equal(hooks.useLearningOwner(), "alice"); owner = undefined; assert.equal(hooks.useLearningOwner(), undefined);

reset();
let destination = "loading", focusCount = 0;
const ref = render(() => hooks.useLearningFocus(destination));
ref.current = { querySelector: () => ({ tabIndex: 0, focus: () => { focusCount++; } }) } as unknown as HTMLDivElement;
render(() => hooks.useLearningFocus(destination)); assert.equal(focusCount, 0);
destination = "lesson:1"; render(() => hooks.useLearningFocus(destination)); assert.equal(focusCount, 1);
render(() => hooks.useLearningFocus(destination)); assert.equal(focusCount, 1);
destination = "lesson:2"; render(() => hooks.useLearningFocus(destination)); assert.equal(focusCount, 2);

// Moved report/comparison loaders still call the existing authenticated clients.
reset(); render(() => hooks.useReportLesson(lab.experiment!.challengeId));
await settle();
pending.shift()!.resolve(catalog); await settle();
assert.equal(requests.at(-1), `${API_URL}/learning/lessons/${lab.id}`);
pending.shift()!.resolve({ lesson: lab, progress: attempted, challenge: null }); await settle();
assert.equal(render(() => hooks.useReportLesson(lab.experiment!.challengeId)).data?.lesson.id, lab.id);

reset(); const labDetail = { lesson: lab, progress: attempted, challenge: null };
render(() => hooks.useLessonActivity(labDetail));
await settle();
assert.equal(requests.at(-1), `${API_URL}/deployments/run-1/report`);
pending.shift()!.reject(Error("Refused")); await settle();
assert.match(render(() => hooks.useLessonActivity(labDetail)).error!, /No outcome is known/);
reset();
const report = { run: { id: "run-1", status: "finished" }, challenge: { challengeId: lab.experiment!.challengeId } } as Parameters<typeof hooks.useLessonComparison>[0];
render(() => hooks.useLessonComparison(report));
await settle();
assert.equal(requests.at(-1), `${API_URL}/deployments/run-1/compare-options`);
pending.shift()!.resolve({ runs: [] }); await settle();
assert.equal(render(() => hooks.useLessonComparison(report)).data, null);
reset();
console.log(JSON.stringify({ requests: true, retry: true, staleResponse: true, storage: true, focus: true, loaders: true }));
