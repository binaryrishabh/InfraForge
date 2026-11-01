import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { OBJECT_STORAGE_CAPACITY_HELP, type Resource } from "@infraforge/domain/resource";
import { ObjectCapacitySection } from "../src/features/canvas/components/inspector/ObjectCapacitySection";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { undo, redo } from "../src/features/canvas/history";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const store: Resource = { id: "store", type: "Object Storage", x: 0, y: 0 };
const resource = () => useCanvasStore.getState().resources[0]!;
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });
function number(value: string) {
  const tree = ObjectCapacitySection({ resource: resource(), disabled: false });
  const field = tree.props.children as ReactElement<{ children(ids: { id: string }): ReactElement<{ onChange(e: { target: { value: string } }): void }> }>;
  field.props.children({ id: "capacity-test" }).props.onChange({ target: { value } });
}
test("Object Storage inspector shows one bounded capacity control and educational explanation", () => {
  const html = renderToStaticMarkup(<Inspector resource={store} />);
  for (const text of ["Stored data capacity (MiB)", OBJECT_STORAGE_CAPACITY_HELP, 'max="8589934591"', 'min="1"', 'step="1"', 'placeholder="Resource profile"']) expect(html).toContain(text);
  expect(renderToStaticMarkup(<Inspector resource={{ ...store, type: "Virtual Machine" }} />)).not.toContain("Stored data capacity");
});
test("capacity edits reject invalid values, undo/redo, and blank restores profile", () => {
  useCanvasStore.getState().loadLayout([store], [], "layout", "Storage"); number("1");
  for (const value of ["0", "-1", "1.5", "NaN", "8589934592"]) number(value);
  expect(resource().objectStoragePolicy).toEqual({ version: 1, capacityMiB: 1 });
  undo(); expect(resource().objectStoragePolicy).toBeUndefined(); redo(); expect(resource().objectStoragePolicy?.capacityMiB).toBe(1);
  number(""); expect(resource().objectStoragePolicy).toBeUndefined();
});
for (const lock of ["liveLocked", "isDeploying"] as const) test(`object capacity honors ${lock}`, () => {
  useCanvasStore.getState().loadLayout([store], [], "layout", "Storage"); useCanvasStore.setState({ [lock]: true });
  number("1"); expect(resource().objectStoragePolicy).toBeUndefined();
  expect(renderToStaticMarkup(<ObjectCapacitySection resource={resource()} disabled />)).toContain('disabled=""');
});
test("capacity survives save and reload", async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([store], [], "layout", "Storage"); number("2");
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "Storage" } } });
  try {
    await saveDesign(); const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[] } };
    expect(payload.layout.resources[0]!.objectStoragePolicy).toEqual({ version: 1, capacityMiB: 2 });
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Storage");
    expect(resource().objectStoragePolicy).toEqual({ version: 1, capacityMiB: 2 });
  } finally { saved.mockRestore(); }
});
