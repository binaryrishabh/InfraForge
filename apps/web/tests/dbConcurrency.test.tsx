import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { Resource, DbConcurrency } from "@infraforge/domain/resource";
import { DbConcurrencySection } from "../src/features/canvas/components/inspector/DbConcurrencySection";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const db: Resource = { id: "db", type: "Database", x: 0, y: 0, dataKeyspace: { version: 1, count: 10, accessPattern: "hot-key" } };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });

test("database inspector exposes only two bounded query controls and retains unset defaults", () => {
  const html = renderToStaticMarkup(<Inspector resource={db} />);
  for (const text of ["Database concurrency", "Active queries", "Queued queries", "Active queries can execute at once. Extra queries wait in the database queue up to this limit.", 'max="512"', 'max="1000"', 'placeholder="Default (16)"', 'placeholder="Default (256)"']) expect(html).toContain(text);
  expect(db).not.toHaveProperty("dbConcurrency");
  expect(renderToStaticMarkup(<DbConcurrencySection resource={{ ...db, size: "large" }} disabled={false} />)).toContain('placeholder="Default (64)"');
});

test("edits preserve the other limit and keyspace, and clearing both restores absence", () => {
  useCanvasStore.getState().loadLayout([db], [], "layout", "Database");
  const edit = (label: string, value: string) => {
    const tree = DbConcurrencySection({ resource: useCanvasStore.getState().resources[0]!, disabled: false });
    type InputField = ReactElement<{ label: string; children: (ids: { id: string; invalid: boolean }) => ReactElement<{ onChange: (event: { target: { value: string } }) => void }> }>;
    const fields = tree.props.children.props.children as InputField[];
    fields.find(f => f.props.label === label)!.props.children({ id: "query-test", invalid: false }).props.onChange({ target: { value } });
  };
  edit("Active queries", "1"); edit("Queued queries", "0");
  expect(useCanvasStore.getState().resources[0]!.dbConcurrency).toEqual({ version: 1, activeQueries: 1, queuedQueries: 0 });
  edit("Active queries", ""); expect(useCanvasStore.getState().resources[0]!.dbConcurrency?.queuedQueries).toBe(0);
  edit("Queued queries", ""); expect(useCanvasStore.getState().resources[0]!.dbConcurrency).toBeUndefined();
  expect(useCanvasStore.getState().resources[0]!.dataKeyspace).toEqual(db.dataKeyspace);
});

for (const lock of ["liveLocked", "isDeploying"] as const) test(`query edits support undo/redo, reject bad values and obey ${lock}`, () => {
  const dbConcurrency: DbConcurrency = { version: 1, activeQueries: 1, queuedQueries: 2 };
  useCanvasStore.getState().loadLayout([db], [], "layout", "Database");
  updateResource("db", { dbConcurrency }); undo(); expect(useCanvasStore.getState().resources[0]!.dbConcurrency).toBeUndefined();
  redo(); expect(useCanvasStore.getState().resources[0]!.dbConcurrency).toEqual(dbConcurrency);
  for (const activeQueries of [0, 1.5, 513]) updateResource("db", { dbConcurrency: { ...dbConcurrency, activeQueries } });
  for (const queuedQueries of [-1, 1.5, 1001]) updateResource("db", { dbConcurrency: { ...dbConcurrency, queuedQueries } });
  expect(useCanvasStore.getState().resources[0]!.dbConcurrency).toEqual(dbConcurrency);
  useCanvasStore.setState({ [lock]: true }); updateResource("db", { dbConcurrency: { version: 1, activeQueries: 8 } });
  const saved = useCanvasStore.getState().resources[0]!; expect(saved.dbConcurrency).toEqual(dbConcurrency);
  const html = renderToStaticMarkup(<DbConcurrencySection resource={saved} disabled />);
  expect(html).toContain('value="1"'); expect(html).toContain('value="2"'); expect(html.match(/disabled=""/g)).toHaveLength(2);
});

for (const dbConcurrency of [undefined, { version: 1 as const, activeQueries: 1 }, { version: 1 as const, queuedQueries: 0 }, { version: 1 as const, activeQueries: 8, queuedQueries: 2 }]) test(`save/reload retains explicit settings and absence: ${JSON.stringify(dbConcurrency)}`, async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([{ ...db, ...(dbConcurrency ? { dbConcurrency } : {}) }], [], "layout", "Database");
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "Database" } } });
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[]; connectionLines: [] } };
    expect(payload.layout.resources[0]!.dbConcurrency).toEqual(dbConcurrency);
    if (!dbConcurrency) expect(payload.layout.resources[0]).not.toHaveProperty("dbConcurrency");
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Database");
    expect(useCanvasStore.getState().resources[0]!.dbConcurrency).toEqual(dbConcurrency);
  } finally { saved.mockRestore(); }
});
