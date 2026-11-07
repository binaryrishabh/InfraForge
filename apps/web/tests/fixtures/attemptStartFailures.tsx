// Exercise the production dialog's handlers and render its actual content. Hook
// storage, HTTP and the portal boundary are seams; no browser timing/DB is claimed.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mock } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ChallengeBrief, ChallengePreflight } from "@infraforge/contracts/challenges";
import type { RunReport } from "@infraforge/contracts/reports";
import { API_URL, http } from "../../src/client/httpClient";
import { useAuthStore } from "../../src/features/auth/store/auth.store";
import { useCanvasStore } from "../../src/features/canvas/store/canvasStore";

const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("../../../backend/tests/fixtures/learningLoop.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
const proof = JSON.parse(stdout) as { brief: ChallengeBrief; sourceReport: RunReport };
assert.equal(proof.sourceReport.provenance.simulationModelVersion, "2");
// The real HTTP interceptor emits expiry; App's redirect/unmount is a browser
// concern. This seam only observes the event, it does not claim draft survival.
const sessionEvents = new EventTarget();
let expired = 0;
sessionEvents.addEventListener("infraforge:session-ended", () => { expired++; });
Object.defineProperty(globalThis, "window", { configurable: true, value: sessionEvents });

let manual = false, cursor = 0;
const states: unknown[] = [];
const originalState = React.useState, originalRef = React.useRef;
mock.module("react", () => ({ ...React,
  useState: (initial: unknown) => {
    if (!manual) return originalState(initial);
    const i = cursor++;
    if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
    return [states[i], (next: unknown) => { states[i] = typeof next === "function" ? next(states[i]) : next; }];
  },
  useRef: (value: unknown) => {
    if (!manual) return originalRef(value);
    const i = cursor++;
    if (!(i in states)) states[i] = { current: value };
    return states[i];
  },
}));
const canvas = useCanvasStore;
mock.module("../../src/features/canvas/store/canvasStore", () => ({ useCanvasStore: Object.assign(
  (select: (state: ReturnType<typeof canvas.getState>) => unknown) => manual ? select(canvas.getState()) : canvas(select), canvas) }));
mock.module("../../src/api/capabilities.api", () => ({ useCapabilityAvailability: () => null }));
mock.module("../../src/features/challenges/learningContext", () => ({ useChallengeImprovement: () => null }));
mock.module("../../src/features/challenges/useImprovementReview", () => ({ useImprovementReview: () => ({ review: null }) }));
const { AttemptDialog, PredictionQuestionField } = await import("../../src/features/challenges/components/AttemptDialog");
const { Field } = await import("../../src/ui/Field");
const { Button } = await import("../../src/ui/Button");
const { ChallengeDebrief } = await import("../../src/features/challenges/components/ChallengeDebrief");
const { BrowserRunNoticeView } = await import("../../src/features/live/BrowserRunNotice");
const { NextStep } = await import("../../src/features/dashboard/pages/HomePage");
const { describeBrowserRun } = await import("../../src/features/model2Run/browserRunMessages");
const { deliver } = await import("../../src/features/model2Run/browserRunDelivery");
const { useBrowserRunStatus } = await import("../../src/features/model2Run/browserRunStatus");

type Element = React.ReactElement<Record<string, unknown>>;
function elements(node: React.ReactNode): Element[] {
  return React.Children.toArray(node).flatMap(child => React.isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as React.ReactNode), ...elements(child.props.footer as React.ReactNode)] : []);
}
let preflight: ChallengePreflight | null = null;
const closed: boolean[] = [];
function tree() {
  manual = true; cursor = 0;
  try { return AttemptDialog({ brief: proof.brief, preflight, open: true, onOpenChange: value => closed.push(value) }); }
  finally { manual = false; }
}
const form = () => elements(tree()).find(node => node.type === "form")!;
const submit = () => form().props.onSubmit as (event: { preventDefault(): void }) => Promise<void>;
const event = { preventDefault() {} };
function html() {
  const dialog = tree();
  return renderToStaticMarkup(<MemoryRouter>{dialog.props.children}{dialog.props.footer}</MemoryRouter>);
}
function answer() {
  const question = elements(tree()).find(node => node.type === PredictionQuestionField)!;
  (question.props.onChange as (value: string) => void)("Virtual Machine");
  const field = elements(tree()).find(node => node.type === Field)!;
  const input = (field.props.children as (ids: { id: string }) => Element)({ id: "reasoning" });
  (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Keep my prediction" } });
}
function reset() {
  states.length = 0; closed.length = 0; preflight = null;
  useAuthStore.setState({ user: { id: "alice", name: "Alice", username: "alice", email: "alice@example.test", emailVerified: true, createdAt: "" } });
  canvas.getState().clearCanvas();
  canvas.setState({ resources: proof.brief.starter!.resources, connectionLines: proof.brief.starter!.connectionLines,
    currentLayoutId: "local-design", currentLayoutSaved: true, currentChallengeId: proof.brief.id, currentChallengeVersion: proof.brief.version });
}

for (const status of [429, 500, 401, undefined]) {
  reset(); answer();
  let requests = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  http.defaults.adapter = async config => {
    requests++;
    assert.equal(config.url, `${API_URL}/challenges/${proof.brief.id}/attempts`);
    assert.deepEqual(JSON.parse(config.data as string).prediction, { answers: { busiest: "Virtual Machine" }, reasoning: "Keep my prediction" });
    await gate;
    // An unstructured 5xx/no response cannot establish whether insertion happened.
    throw Object.assign(Error("HTTP unavailable"), { isAxiosError: true,
      ...(status === undefined ? {} : { response: { status, data: status === 429 || status === 401 ? { message: "Server refused this request" } : {} } }) });
  };
  const captured = submit(), first = captured(event);
  await captured(event); // Same event-loop turn, before React renders busy state.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1, "rapid submits must share the first start");
  assert.equal(elements(tree()).find(node => node.type === Button && node.props.type === "submit")!.props.loading, true);
  release(); await first;
  const content = html();
  assert.match(content, /role="alert"/);
  assert.match(content, /Keep my prediction/);
  assert.match(content, /Your answers stay here while this dialog remains open/);
  assert.match(content, /href="\/runs"[^>]*>Check Runs before trying again/);
  assert.match(content, /A lost response can hide a started attempt/);
  assert.match(content, /If your session ends, sign in and check Runs/);
  assert.doesNotMatch(content, /Your prediction was not recorded/);
  if (status === 500 || status === undefined) assert.match(content, /The attempt start could not be confirmed/);
  else assert.match(content, /Server refused this request/);
  assert.equal(elements(tree()).find(node => node.type === PredictionQuestionField)!.props.value, "Virtual Machine");
  assert.equal(elements(tree()).find(node => node.type === Button && node.props.type === "submit")!.props.loading, false);
  assert.equal(canvas.getState().activeDeploymentId, null);
  assert.equal(canvas.getState().isDeploying, false);
  assert.deepEqual(closed, []);
  // The failure releases the synchronous guard, so an explicit retry is possible.
  await submit()(event); assert.equal(requests, 2);
}
assert.equal(expired, 2);

reset(); answer();
let requests = 0;
http.defaults.adapter = async () => { requests++; throw Error("Must not request"); };
preflight = { valid: false, errors: ["Fix the design before starting"], checks: [], warnings: [], resourceTypes: [], experiment: null };
await submit()(event);
assert.equal(requests, 0); assert.match(html(), /The design cannot run yet/);
assert.equal(elements(tree()).find(node => node.type === Button && node.props.type === "submit")!.props.disabled, true);

// After an uncertain response the recovery destination must use the saved server
// report. This is the unmodified real-engine record; no new verdict is invented.
const recorded = renderToStaticMarkup(<MemoryRouter><ChallengeDebrief evaluation={proof.sourceReport.challenge!} brief={proof.brief} /></MemoryRouter>);
assert.match(recorded, /Your prediction/);
assert.match(recorded, /Not every requirement was met/);
assert.ok(recorded.includes(proof.sourceReport.challenge!.predictions[0]!.detail));

// The server can hold the real-engine record while both submission replies and
// status reads fail. Neither production component may conclude that it was lost.
let serverHoldsReport = false;
const deliveryStates: Array<Parameters<typeof describeBrowserRun>[0]> = [];
assert.equal(await deliver({
  send: async () => { serverHoldsReport = true; throw Error("Reply lost"); },
  currentStatus: async () => { throw Error("Status unavailable"); },
  sleep: async () => {}, report: state => { deliveryStates.push(state); },
}), "unsent");
assert.equal(serverHoldsReport, true);
const unconfirmed = deliveryStates.at(-1)!;
const message = describeBrowserRun(unconfirmed, null)!;
let resend = 0;
const notice = BrowserRunNoticeView({ message, sending: false, onSendAgain: () => { resend++; }, onLeave() {} });
const noticeHtml = renderToStaticMarkup(notice);
assert.match(noticeHtml, /role="alert"/);
assert.match(noticeHtml, /We could not confirm your run was saved/);
assert.match(noticeHtml, /Server receipt and verification have not been confirmed/);
assert.doesNotMatch(noticeHtml, /exists only in this tab|Your run has not been saved/);
(elements(notice).find(node => node.type === Button)!.props.onClick as () => void)();
assert.equal(resend, 1);
const initial = useBrowserRunStatus.getInitialState(), previous = initial.runs;
initial.runs = { [proof.sourceReport.run.id]: unconfirmed };
let home: string;
try {
  home = renderToStaticMarkup(<MemoryRouter><NextStep next={{ kind: "live", run: {
    id: proof.sourceReport.run.id, infrastructureId: "local-design", infrastructureName: proof.sourceReport.run.infrastructureName,
    status: "browser", resourceCount: proof.sourceReport.run.resourceCount, challengeId: proof.brief.id,
    createdAt: proof.sourceReport.run.createdAt, updatedAt: proof.sourceReport.run.updatedAt,
  } }} /></MemoryRouter>);
} finally { initial.runs = previous; }
assert.match(home, /We could not confirm your run was saved/);
assert.match(home, /Open it and send again/);
assert.doesNotMatch(home, /server did not receive it|exists only in this tab|Discard this run/);
console.log(JSON.stringify({ realDialog: true, retained: true, duplicateBlocked: true, preflightRefused: true, uncertainStart: true, realModel2Report: true, unconfirmedDelivery: true }));
