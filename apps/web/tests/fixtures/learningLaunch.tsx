// Isolate the navigation and button observation seams from the rest of the suite.
// React server rendering runs the real lesson wrapper and shared challenge hook.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LearningLessonDetail } from "@infraforge/contracts/learning";
import { catalog, lab } from "../learningFixtures";
import { API_URL, http } from "../../src/client/httpClient";
import { useCanvasStore } from "../../src/features/canvas/store/canvasStore";

const router = await import("react-router-dom");
const buttons = await import("../../src/ui/Button");
const OriginalButton = buttons.Button;
let click: (() => void) | null = null;
let navigation: string[] = [], notices: string[] = [], requests: { url: string; data: unknown }[] = [];
let settle: () => void = () => {};
mock.module("react-router-dom", () => ({ ...router, useNavigate: () => (to: string) => { navigation.push(to); settle(); } }));
mock.module("sonner", () => ({ toast: {
  info: (message: string) => { notices.push(message); }, error: (message: string) => { notices.push(message); settle(); },
} }));
mock.module("../../src/ui/Button", () => ({ ...buttons, Button: (props: ComponentProps<typeof OriginalButton>) => {
  if (props.children === "Open challenge lab") click = () => props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
  return createElement(OriginalButton, props);
} }));
const { LessonView } = await import("../../src/features/learning/LessonPage");
const detail: LearningLessonDetail = { lesson: lab, progress: null,
  challenge: { id: "first-production-api", version: 2, specHash: "a".repeat(64), title: "First production API", summary: "Open its workspace.",
    evaluationSeconds: 120, requirementCount: 4, executable: true } };
const ready = <T,>(data: T) => ({ data, loading: false, error: null, retry() {} });
function pressLaunch() {
  assert.ok(click, "The actual LessonView must render a lab launch button");
  click();
}

async function launch({ active = false, live = false, starting = false, fail = false } = {}) {
  useCanvasStore.getState().clearCanvas();
  useCanvasStore.setState({ activeDeploymentId: active ? "existing-run" : null, liveMode: live, isDeploying: starting, liveLocked: active });
  navigation = []; notices = []; requests = []; click = null;
  http.defaults.adapter = async (config) => {
    assert.equal(config.method, "post");
    assert.equal(config.withCredentials, true);
    requests.push({ url: config.url!, data: JSON.parse(config.data as string) });
    if (fail) throw Error("Workspace unavailable");
    return { status: 200, statusText: "OK", headers: {}, config, data: { designId: "lesson workspace/1", created: false } };
  };
  renderToStaticMarkup(createElement(router.MemoryRouter, null, createElement(LessonView, { ...ready(detail), catalog: ready(catalog) })));
  let deadline: ReturnType<typeof setTimeout>;
  const completed = new Promise<void>((resolve, reject) => {
    settle = resolve;
    deadline = setTimeout(() => reject(Error("The launch neither navigated nor reported a failure")), 10000);
  });
  try { pressLaunch(); await completed; } finally { clearTimeout(deadline!); }
  return { navigation: [...navigation], notices: [...notices], requests: [...requests] };
}

const opened = await launch();
assert.deepEqual(opened.requests, [{ url: `${API_URL}/challenges/first-production-api/workspace`, data: { fresh: false } }]);
assert.deepEqual(opened.navigation, ["/design?design=lesson%20workspace%2F1"]);
assert.deepEqual(opened.notices, []);
for (const state of [{ active: true, live: true }, { active: true, starting: true }]) {
  const guarded = await launch(state);
  assert.deepEqual(guarded.requests, []);
  assert.deepEqual(guarded.navigation, ["/design"]);
  assert.ok(guarded.notices[0]?.includes("A run is still going"));
  assert.equal(useCanvasStore.getState().activeDeploymentId, "existing-run");
}
const finished = await launch({ active: true });
assert.equal(finished.requests.length, 1);
assert.equal(useCanvasStore.getState().activeDeploymentId, null);
assert.equal(useCanvasStore.getState().liveLocked, false);
const failed = await launch({ fail: true });
assert.equal(failed.requests.length, 1);
assert.deepEqual(failed.navigation, []);
assert.ok(failed.notices[0]?.includes("Workspace unavailable"));
console.log(JSON.stringify({ openedChallenge: "first-production-api", designer: opened.navigation[0], liveGuard: true,
  startingGuard: true, finishedViewLeft: true, failedOpenStayedOnLesson: true }));
