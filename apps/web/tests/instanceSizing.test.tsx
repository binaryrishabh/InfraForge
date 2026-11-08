import { afterEach, expect, spyOn, test } from "bun:test";
import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { findSku } from "@infraforge/catalog";
import type { Resource } from "@infraforge/domain/resource";
import { http } from "../src/client/httpClient";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { updateResource } from "../src/features/canvas/actions";
import { saveDesign } from "../src/features/canvas/designActions";
import { installDesign } from "../src/features/canvas/designLoader";
import { undo, redo } from "../src/features/canvas/history";
import { InstanceSection, InstanceSizeChoices } from "../src/features/canvas/components/inspector/InstanceSection";

const db: Resource = { id: "db", type: "Database", x: 0, y: 0, size: "small", name: "Notes" };
const state = () => useCanvasStore.getState();
afterEach(() => { state().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });

// Exercise the actual radio callbacks without adding a DOM harness.
function choose(label: string) {
  const tree = InstanceSizeChoices({ resource: state().resources[0]!, disabled: false, provider: "aws" });
  type Label = ReactElement<{ children: [ReactElement<{ onChange(): void }>, ReactElement<{ children: ReactElement<{ children: string }>[] }> ] }>;
  const fieldset = tree.props.children[3] as ReactElement<{ children: [ReactElement, ReactElement<{ children: Label[] }>] }>;
  const option = fieldset.props.children[1].props.children.find(option => option.props.children[1].props.children[0]!.props.children === label);
  if (!option) throw Error(`Missing size ${label}`);
  option.props.children[0].props.onChange();
}

test("instance radios name generic cores and advertised catalog vCPU, default to small and lock natively", () => {
  for (const type of ["Database", "Virtual Machine"] as const) {
    const html = renderToStaticMarkup(<InstanceSection resource={{ ...db, type, size: undefined }} disabled={false} />);
    for (const text of ["Generic Small", "Generic Medium", "Generic Large", "1 assumed core", "2 assumed cores", "4 assumed cores", "advertised vCPU", "Choosing one replaces the other", "same educational monthly estimate"]) expect(html).toContain(text);
    expect(html).toContain('<legend class="sr-only">Instance size</legend>');
    expect(html.match(/type="radio"[^>]*checked=""/g)).toHaveLength(1);
    // Native labelled radios share a group, providing Tab/arrow/Space operation.
    expect(html).toContain('name="sku-db"');
    expect(html).not.toContain("qps"); expect(html).not.toContain("rps");
    expect(renderToStaticMarkup(<InstanceSection resource={{ ...db, type }} disabled />)).toContain('<fieldset class="mt-3" disabled="">');
  }
});

test("radio edits replace SKU or generic size, preserve the design, and undo/redo both fields", () => {
  state().loadLayout([db], [], "saved", "Notes");
  choose("Generic Medium");
  expect(state().resources).toEqual([{ ...db, size: "medium", skuId: undefined }]);
  expect(state().currentLayoutSaved).toBe(false);
  undo(); expect(state().resources[0]!.size).toBe("small");
  redo(); expect(state().resources[0]!.size).toBe("medium");
  choose("Generic Large"); expect(state().resources[0]!.size).toBe("large");
  // Read the actual catalog label so this test exercises the same option, without owning catalog copy.
  choose(findSku("db.m5.large")!.label);
  expect(state().resources[0]).toEqual({ ...db, size: undefined, skuId: "db.m5.large" });
  // Existing history coalesces consecutive edits to the same fields.
  undo(); expect(state().resources[0]).toEqual({ ...db, size: "small", skuId: undefined });
  redo(); choose("Generic Small");
  expect(state().resources[0]).toEqual({ ...db, size: "small", skuId: undefined });
  useCanvasStore.setState({ liveLocked: true }); choose("Generic Medium");
  expect(state().resources[0]!.size).toBe("small");
  useCanvasStore.setState({ liveLocked: false, isDeploying: true }); choose("Generic Large");
  expect(state().resources[0]!.size).toBe("small");
});

test("existing conflicting states show SKU precedence; invalid states never silently select generic small", () => {
  const both = { ...db, size: "large" as const, skuId: "db.m5.large" };
  const html = renderToStaticMarkup(<InstanceSection resource={both} disabled={false} />);
  expect(html).toContain("catalog choice overrides the saved generic size");
  expect(html.match(/type="radio"[^>]*checked=""/g)).toHaveLength(1);
  state().loadLayout([both], [], "saved", "Notes");
  choose("Generic Medium"); expect(state().resources[0]!.skuId).toBeUndefined();
  undo(); expect(state().resources[0]).toEqual(both);
  for (const invalid of [{ ...db, size: "extra-large" as Resource["size"] }, { ...db, skuId: "unknown" }, { ...db, skuId: "c5.large" }]) {
    const bad = renderToStaticMarkup(<InstanceSection resource={invalid} disabled={false} />);
    expect(bad).toContain('role="alert"');
    expect(bad).not.toMatch(/type="radio"[^>]*checked=""/);
  }
  updateResource("db", { size: "extra-large" as Resource["size"] });
  expect(state().resources[0]).toEqual(both);
});

test("saveDesign sends generic size and installDesign reloads the returned JSON unchanged", async () => {
  useAuthStore.setState({ user: { id: "sizing-owner", name: "Owner", username: null, email: "sizing@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  state().loadLayout([db], [], "saved", "Notes");
  choose("Generic Medium");
  const response = JSON.parse(JSON.stringify({ id: "saved", name: "Notes", layout: { resources: [{ ...db, size: "medium" }], connectionLines: [], layoutVersion: 3 } }));
  const write = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: response } });
  try {
    const saved = await saveDesign();
    const savedLayout: unknown = JSON.parse(JSON.stringify(write.mock.calls[0]![1]));
    expect(savedLayout).toEqual({ layout: { resources: [{ ...db, size: "medium" }], connectionLines: [], layoutVersion: 3 } });
    state().clearCanvas(); installDesign(saved!);
    expect(state().resources).toEqual([{ ...db, size: "medium" }]);
    const reloaded = renderToStaticMarkup(<InstanceSection resource={state().resources[0]!} disabled={false} />);
    expect(reloaded).toMatch(/checked=""\/><span[^>]*><span[^>]*>Generic Medium/);
  } finally { write.mockRestore(); }
});
