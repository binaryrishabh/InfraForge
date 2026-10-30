import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { InterventionOption } from "@infraforge/contracts/actions";
import { interventionError } from "@infraforge/domain/resource";
import * as React from "react";
import * as fields from "../src/ui/Field";
import * as browserRuns from "../src/features/model2Run/browserRuns";
import { FaultControl } from "../src/features/live/controls/FaultControl";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";

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
