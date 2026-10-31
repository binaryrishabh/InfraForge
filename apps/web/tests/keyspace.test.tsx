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

test("the actual save payload and store reload preserve the optional keyspace", async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([db], [], "layout", "Data");
  updateResource("db", { dataKeyspace: { version: 1, count: 100 } });
  const saved = spyOn(http, "put").mockResolvedValue({ data: { infrastructure: { id: "layout", name: "Data" } } });
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[]; connectionLines: [] } };
    expect(payload.layout.resources[0]!.dataKeyspace).toEqual({ version: 1, count: 100 });
    useCanvasStore.getState().clearCanvas();
    useCanvasStore.getState().loadLayout(payload.layout.resources, payload.layout.connectionLines, "layout", "Data");
    expect(useCanvasStore.getState().resources[0]!.dataKeyspace).toEqual({ version: 1, count: 100 });
    expect(useCanvasStore.getState().undoStack).toEqual([]);
    updateResource("db", { dataKeyspace: { version: 1, count: 10 } }); undo();
    expect(useCanvasStore.getState().resources[0]!.dataKeyspace?.count).toBe(100);
  } finally { saved.mockRestore(); }
});
