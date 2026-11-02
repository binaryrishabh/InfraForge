import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { InterventionOption } from "@infraforge/contracts/actions";
import { interventionError } from "@infraforge/domain/resource";
import * as React from "react";
import * as fields from "../src/ui/Field";
import * as browserRuns from "../src/features/model2Run/browserRuns";
import { FaultControl } from "../src/features/live/controls/FaultControl";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { NodeLive } from "../src/features/live/NodeLive";
import { ActionTimeline } from "../src/features/reports/components/ActionTimeline";
import type { RunAction } from "@infraforge/contracts/actions";

const resources = [{ id: "app", name: "Upload API", type: "Virtual Machine" as const, x: 0, y: 0 }, { id: "db", name: "Orders database", type: "Database" as const, x: 0, y: 0 }];
const lines = [{ id: "opaque-edge-7", sourceId: "app", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432 }];
const initial = useCanvasStore.getInitialState(), previousLines = initial.connectionLines;
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; initial.connectionLines = previousLines; });

function capabilities(options: InterventionOption[]) {
  const read = spyOn(browserRuns, "browserRunFor").mockReturnValue({ speed: 1, interventions: { options, remainingSeconds: 10 },
    controls: { setSpeed: () => {}, act: async () => ({ ok: true, outcome: {} }), stop: () => {}, cancel: () => {} } });
  restore = () => read.mockRestore();
}
const render = () => renderToStaticMarkup(<FaultControl deploymentId="run" resources={resources} />);

test("selected CDN exposes a parameterless enabled purge with consequence copy and hides it for other or locked nodes", () => {
  const cdn = {id: "cdn", type: "CDN" as const, x: 0, y: 0};
  capabilities([{interventionId: "cdn-purge", revision: 1, target: {resourceId: "cdn"}, resolvedTargets: ["cdn"], affectedPaths: []}]);
  const node = (resource = cdn, controls = true, ended = false) => renderToStaticMarkup(<NodeLive deploymentId="run" resource={resource} resources={[...resources, cdn]} controls={controls} ended={ended} />);
  const html = node();
  expect(html).toContain("Purge CDN cache</option>");
  expect(html).toMatch(/<button(?![^>]* disabled=)[^>]*>.*?Purge CDN cache<\/button>/s);
  expect(html).toContain("Removes the CDN&#x27;s currently cached entries. The next request must fetch from the origin again.");
  expect(html).not.toContain('<input');
  expect(node({...cdn, id: "db"})).not.toContain("Purge CDN cache");
  expect(node(cdn, false)).not.toContain("Purge CDN cache");
  expect(node(cdn, false, true)).not.toContain("Purge CDN cache");
  restore!(); restore = undefined; capabilities([]);
  expect(node()).toContain("No supported intervention for this target.");
  expect(node()).not.toContain("Purge CDN cache");
});

test("durable CDN action timeline retains its label, exact microsecond and one-shot completion", () => {
  const at = new Date(0).toISOString();
  const action = {id: "purge", deploymentId: "run", sequence: 1, kind: "intervention", parameters: {interventionId: "cdn-purge", revision: 1, target: {resourceId: "cdn"}, parameters: {}}, status: "completed", requestedAt: at, appliedAt: at, completedAt: at, appliedSimulatedSeconds: 1, completedSimulatedSeconds: 2, outcome: {intervention: {actionId: "a1", interventionId: "cdn-purge", revision: 1, target: {resourceId: "cdn"}, parameters: {}, resolvedTargets: ["cdn"], affectedPaths: [], atUs: 1_000_001, endUs: null}, interventionEnded: true}, failureReason: null} as RunAction;
  const html = renderToStaticMarkup(<ActionTimeline actions={[action]} />);
  expect(html).toContain("Purge CDN cache v1 on cdn: one-shot");
  expect(html).toContain("Applies at 1000001 us; one-shot");
  expect(html).toContain("Control completed; downstream effects may remain.");
});

test("validation waits for an edit, uses human status copy and clears after correction", () => {
  capabilities([{ interventionId: "cpu-capacity", revision: 1, target: { resourceId: "db" }, authoredBaseline: 2, resolvedTargets: ["db/main"], affectedPaths: [] }]);
  // Exercise the real field handlers across static renders without a DOM dependency.
  const states: unknown[] = [];
  let cursor = 0, inputs: React.InputHTMLAttributes<HTMLInputElement>[] = [];
  const state = spyOn(React, "useState").mockImplementation(((initial: unknown) => {
    const index = cursor++;
    if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
    return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
  }) as typeof React.useState);
  const input = spyOn(fields, "Input").mockImplementation(props => { inputs.push(props); return <input {...props} />; });
  const view = () => { cursor = 0; inputs = []; return render(); };
  const edit = (index: number, value: string) => inputs[index]!.onChange!({ target: { value } } as React.ChangeEvent<HTMLInputElement>);
  try {
    const pristine = view();
    expect(pristine).not.toContain("INTERVENTION_BOUNDS");
    expect(pristine).not.toContain('role="alert"');
    expect(pristine).not.toContain('role="status"');
    expect(pristine).toMatch(/<button[^>]*disabled=""[^>]*>.*?Apply cpu capacity/s);
    edit(0, "-1");
    const invalid = view();
    const reason = interventionError({ interventionId: "cpu-capacity", revision: 1, target: { resourceId: "db" }, parameters: { cores: -1, duration: NaN } }, { authoredBaseline: 2, remainingSeconds: 10 })!;
    expect(invalid).toContain('role="status"');
    expect(invalid).not.toContain('role="alert"');
    expect(invalid).not.toContain("INTERVENTION_BOUNDS:");
    expect(invalid).toContain(reason.replace(/^\w+:\s*/, "").replace(/^./, c => c.toUpperCase()) + ".");
    edit(0, "1"); view(); edit(1, "2");
    expect(view()).not.toContain('role="status"');
    edit(0, "");
    expect(view()).toContain('role="status"');
  } finally { input.mockRestore(); state.mockRestore(); }
});

test("edge choices resolve endpoint names and retain direction; missing edges fall back to their id", () => {
  initial.connectionLines = lines;
  capabilities(["request", "response", "both"].map(direction => ({ interventionId: "delay", revision: 1, target: { edgeId: "opaque-edge-7", direction: direction as "request" | "response" | "both" }, resolvedTargets: [], affectedPaths: [] })));
  const named = render();
  for (const direction of ["request", "response", "both"]) expect(named).toContain(`Upload API → Orders database (${direction})</option>`);
  expect(named).not.toContain(">opaque-edge-7 (");
  initial.connectionLines = [];
  expect(render()).toContain(">opaque-edge-7 (request)</option>");
});

test("one-shot intervention with valid empty parameters has no validation alert", () => {
  capabilities([{ interventionId: "flush", revision: 1, target: { resourceId: "cache" }, resolvedTargets: [], affectedPaths: [] }]);
  expect(render()).not.toContain('role="alert"');
});

test("parallel edges with identical display names fall back to distinct ids and directions", () => {
  initial.connectionLines = [...lines, { ...lines[0]!, id: "parallel-edge-8", port: 6432 }];
  capabilities(initial.connectionLines.map(line => ({ interventionId: "delay", revision: 1, target: { edgeId: line.id, direction: "request" }, resolvedTargets: [], affectedPaths: [] })));
  const html = render();
  expect(html).toContain(">opaque-edge-7 (request)</option>");
  expect(html).toContain(">parallel-edge-8 (request)</option>");
  expect(html).not.toContain(">Upload API → Orders database (request)</option>");
});
