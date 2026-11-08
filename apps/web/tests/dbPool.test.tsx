import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { Resource } from "@infraforge/domain/resource";
import { DbPoolEditor, DbPoolSection } from "../src/features/canvas/components/inspector/DbPoolSection";
import { parseDbPool } from "../src/features/canvas/components/inspector/dbPoolInput";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";
import { fileURLToPath } from "node:url";
const db: Resource = {id: "db", type: "Database", x: 0, y: 0, dbConcurrency: {version: 1, activeQueries: 4}};
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({user: null, status: "guest"}); });
test("the real draft subscription preserves pool values and absence across reload", async () => {
 const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./fixtures/dbPoolDraft.ts", import.meta.url))], {stdout: "pipe", stderr: "pipe"});
 const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
 expect(await child.exited, err).toBe(0); expect(out).toContain("pool draft persistence and reload passed");
});
test("pool control has a native numeric accessible name, bounds, default and independent query controls", () => {
 const html = renderToStaticMarkup(<Inspector resource={db} />);
 for (const text of ["Application database connections", "per VM replica and database path", "database&#x27;s own session limit", "Active queries", 'placeholder="Default (10)"', 'type="number"', 'min="1"', 'max="512"', 'step="1"']) expect(html).toContain(text);
 const match = /<label for="([^"]+)"[^>]*>Application database connections<\/label>/.exec(html)!;
 expect(html).toContain(`<input`); expect(html).toContain(`id="${match[1]}"`);
 const locked = renderToStaticMarkup(<DbPoolSection resource={{...db, dbPoolMaxConnections: 2}} disabled />);
 expect(locked).toContain('value="2"'); expect(locked).toContain('disabled=""');
 const wrongOwner = renderToStaticMarkup(<Inspector resource={{id: "app", type: "Virtual Machine", x: 0, y: 0}} />);
 expect(wrongOwner).not.toContain("Application database connections");
});
test("real input handler retains valid edits, refuses out-of-range drafts with an accessible error and clears to default", () => {
 useCanvasStore.getState().loadLayout([db], [], "layout", "Pool");
 const edit = (text: string, disabled = false) => {
  const tree = DbPoolEditor({resource: useCanvasStore.getState().resources[0]!, text, disabled, onText: () => {}});
  const field = tree.props.children as ReactElement<{children: (ids: {id: string; invalid: boolean}) => ReactElement<{onChange: (e: {target: {value: string}}) => void}>}>;
  field.props.children({id: "pool-test", invalid: false}).props.onChange({target: {value: text}});
 };
 for (const value of [1, 2, 512]) { edit(String(value)); expect(useCanvasStore.getState().resources[0]!.dbPoolMaxConnections).toBe(value); }
 for (const text of ["0", "-1", "1.5", "513", "NaN", "Infinity", " "]) {
  edit(text); expect(useCanvasStore.getState().resources[0]!.dbPoolMaxConnections).toBe(512);
  expect(parseDbPool(text).error).toBeString();
  const html = renderToStaticMarkup(<DbPoolEditor resource={db} text={text} disabled={false} onText={() => {}} />);
  expect(html).toContain('aria-invalid="true"'); expect(html).toContain('role="alert"');
 }
 edit("2", true); expect(useCanvasStore.getState().resources[0]!.dbPoolMaxConnections).toBe(512);
 edit(""); expect(useCanvasStore.getState().resources[0]!.dbPoolMaxConnections).toBeUndefined();
 expect(useCanvasStore.getState().resources[0]!.dbConcurrency).toEqual(db.dbConcurrency);
});
for (const lock of ["liveLocked", "isDeploying"] as const) test(`pool undo/redo and ${lock} preserve intent`, () => {
 useCanvasStore.getState().loadLayout([db], [], "layout", "Pool");
 updateResource("db", {dbPoolMaxConnections: 2}); undo(); expect(useCanvasStore.getState().resources[0]!.dbPoolMaxConnections).toBeUndefined();
 redo(); expect(useCanvasStore.getState().resources[0]!.dbPoolMaxConnections).toBe(2);
 updateResource("db", {dbPoolMaxConnections: 0}); expect(useCanvasStore.getState().resources[0]!.dbPoolMaxConnections).toBe(2);
 useCanvasStore.setState({[lock]: true}); updateResource("db", {dbPoolMaxConnections: 8}); expect(useCanvasStore.getState().resources[0]!.dbPoolMaxConnections).toBe(2);
});
for (const value of [undefined, 1, 2, 512]) test(`save and reload preserve application pool maximum ${value}`, async () => {
 useAuthStore.setState({user: {id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString()}, status: "authenticated"});
 useCanvasStore.getState().loadLayout([{...db, ...(value === undefined ? {} : {dbPoolMaxConnections: value})}], [], "layout", "Pool");
 const saved = spyOn(http, "put").mockResolvedValue({data: {updatedInfrastructure: {id: "layout", name: "Pool"}}});
 try {
  await saveDesign(); const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as {layout: {resources: Resource[]}};
  expect(payload.layout.resources[0]!.dbPoolMaxConnections).toBe(value);
  if (value === undefined) expect(payload.layout.resources[0]).not.toHaveProperty("dbPoolMaxConnections");
  useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Pool");
  const html = renderToStaticMarkup(<DbPoolSection resource={useCanvasStore.getState().resources[0]!} disabled={false} />);
  expect(html).toContain(`value="${value ?? ""}"`);
 } finally { saved.mockRestore(); }
});
