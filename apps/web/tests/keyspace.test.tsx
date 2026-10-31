import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Resource } from "@infraforge/domain/resource";
import { DataKeyspaceSection } from "../src/features/canvas/components/inspector/DataKeyspaceSection";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const db: Resource = { id: "db", type: "Database", x: 0, y: 0 };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });

test("database inspector has the minimal bounded control and explanatory line, locked during runs", () => {
  const html = renderToStaticMarkup(<DataKeyspaceSection resource={db} disabled />);
  expect(html).toContain("Data keyspace"); expect(html).toContain("Number of distinct application data keys used by this workload.");
  expect(html).toContain("disabled"); expect(html).toContain('value="1" selected'); expect(html).toContain('value="1000"');
  expect(renderToStaticMarkup(<Inspector resource={{ ...db, type: "Cache" }} />)).not.toContain("Data keyspace");
});

test("multi-key databases expose a tiny uniform/hot-key control with historical uniform default", () => {
  const multi: Resource = { ...db, dataKeyspace: { version: 1, count: 100 } };
  const html = renderToStaticMarkup(<DataKeyspaceSection resource={multi} disabled={false} />);
  expect(html).toContain("Access pattern"); expect(html).toContain('value="uniform" selected'); expect(html).toContain("Hot-key");
  expect(html).toContain("About 80% of accesses use one stable key; the rest use the remaining keys.");
  const hot = renderToStaticMarkup(<DataKeyspaceSection resource={{ ...multi, dataKeyspace: { ...multi.dataKeyspace!, accessPattern: "hot-key" } }} disabled />);
  expect(hot).toContain('value="hot-key" selected'); expect(hot.match(/disabled=""/g)).toHaveLength(2);
  expect(renderToStaticMarkup(<DataKeyspaceSection resource={db} disabled={false} />)).not.toContain("Access pattern");
});

test("hot-key edits undo/redo, reject invalid patterns and obey the run lock", () => {
  const uniform: Resource = { ...db, dataKeyspace: { version: 1, count: 10 } };
  useCanvasStore.getState().loadLayout([uniform], [], "layout", "Data");
  const hot = { ...uniform.dataKeyspace!, accessPattern: "hot-key" as const };
  updateResource("db", { dataKeyspace: hot }); expect(useCanvasStore.getState().resources[0]!.dataKeyspace).toEqual(hot);
  undo(); expect(useCanvasStore.getState().resources[0]!.dataKeyspace).toEqual(uniform.dataKeyspace);
  redo(); expect(useCanvasStore.getState().resources[0]!.dataKeyspace).toEqual(hot);
  const invalid = structuredClone(hot); Object.assign(invalid, { accessPattern: "zipf" });
  updateResource("db", { dataKeyspace: invalid }); expect(useCanvasStore.getState().resources[0]!.dataKeyspace).toEqual(hot);
  useCanvasStore.setState({ liveLocked: true }); updateResource("db", { dataKeyspace: uniform.dataKeyspace });
  expect(useCanvasStore.getState().resources[0]!.dataKeyspace).toEqual(hot);
});

test("keyspace edits undo/redo, refuse invalid values and obey the run lock", () => {
  useCanvasStore.getState().loadLayout([db], [], "layout", "Data");
  updateResource("db", { dataKeyspace: { version: 1, count: 10 } });
  expect(useCanvasStore.getState().resources[0]!.dataKeyspace?.count).toBe(10);
  undo(); expect(useCanvasStore.getState().resources[0]!.dataKeyspace).toBeUndefined();
  redo(); expect(useCanvasStore.getState().resources[0]!.dataKeyspace?.count).toBe(10);
  updateResource("db", { dataKeyspace: { version: 1, count: 1001 } });
  expect(useCanvasStore.getState().resources[0]!.dataKeyspace?.count).toBe(10);
  useCanvasStore.setState({ liveLocked: true }); updateResource("db", { dataKeyspace: { version: 1, count: 100 } });
  expect(useCanvasStore.getState().resources[0]!.dataKeyspace?.count).toBe(10);
  expect(renderToStaticMarkup(<Inspector resource={useCanvasStore.getState().resources[0]} />)).toContain("disabled");
});

for (const accessPattern of [undefined, "uniform", "hot-key"] as const) test(`save and reload preserve the optional access pattern, pattern=${accessPattern}`, async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([db], [], "layout", "Data");
  const dataKeyspace = { version: 1 as const, count: 100, ...(accessPattern ? { accessPattern } : {}) };
  updateResource("db", { dataKeyspace });
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "Data" } } });
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[]; connectionLines: [] } };
    expect(payload.layout.resources[0]!.dataKeyspace).toEqual(dataKeyspace);
    useCanvasStore.getState().clearCanvas();
    useCanvasStore.getState().loadLayout(payload.layout.resources, payload.layout.connectionLines, "layout", "Data");
    expect(useCanvasStore.getState().resources[0]!.dataKeyspace).toEqual(dataKeyspace);
    expect(useCanvasStore.getState().undoStack).toEqual([]);
    updateResource("db", { dataKeyspace: { version: 1, count: 10 } }); undo();
    expect(useCanvasStore.getState().resources[0]!.dataKeyspace?.count).toBe(100);
  } finally { saved.mockRestore(); }
});
