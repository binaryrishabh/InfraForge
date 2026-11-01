import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { CDN_COALESCING_HELP, CDN_WAITERS_HELP, type CdnCachePolicy, type Resource } from "@infraforge/domain/resource";
import { CdnCoalescingControls } from "../src/features/canvas/components/inspector/CdnCoalescingControls";
import { CdnTtlSection } from "../src/features/canvas/components/inspector/CdnTtlSection";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { undo, redo } from "../src/features/canvas/history";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const cdn: Resource = { id: "cdn", type: "CDN", x: 0, y: 0 };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });
const resource = () => useCanvasStore.getState().resources[0]!;
function toggle(value: boolean) {
  const tree = CdnCoalescingControls({ resource: resource(), disabled: false });
  const control = tree.props.children[0] as ReactElement<{ onChange(value: boolean): void }>;
  control.props.onChange(value);
}
function number(value: string, ttl = false) {
  const tree = ttl ? CdnTtlSection({ resource: resource(), disabled: false }) : CdnCoalescingControls({ resource: resource(), disabled: false });
  const field = tree.props.children[ttl ? 0 : 1] as ReactElement<{ children(ids: { id: string }): ReactElement<{ onChange(e: { target: { value: string } }): void }> }>;
  field.props.children({ id: "cdn-test" }).props.onChange({ target: { value } });
}

test("CDN controls show default On and bounded blank limit with exact explanations", () => {
  const html = renderToStaticMarkup(<Inspector resource={cdn} />);
  for (const text of ["Coalesce concurrent misses", "Shared-fill request limit", CDN_COALESCING_HELP, CDN_WAITERS_HELP, 'aria-checked="true"', 'max="100000"', 'placeholder="256"']) expect(html).toContain(text);
  expect(cdn.cdnCachePolicy).toBeUndefined();
  expect(renderToStaticMarkup(<Inspector resource={{ ...cdn, type: "Object Storage" }} />)).not.toContain("Coalesce concurrent misses");
  expect(renderToStaticMarkup(<CdnCoalescingControls resource={{ ...cdn, cdnCachePolicy: { version: 2, coalesce: false } }} disabled={false} />)).not.toContain("Shared-fill request limit");
});

test("authoring limit and toggle preserves TTL, refuses bad values, removes Off limit and supports undo/redo", () => {
  useCanvasStore.getState().loadLayout([{ ...cdn, cdnCachePolicy: { version: 1, ttlSeconds: 25 } }], [], "layout", "CDN");
  number("3"); expect(resource().cdnCachePolicy).toEqual({ version: 2, coalesce: true, maxWaiters: 3, ttlSeconds: 25 });
  undo(); expect(resource().cdnCachePolicy).toEqual({ version: 1, ttlSeconds: 25 });
  redo(); expect(resource().cdnCachePolicy).toMatchObject({ version: 2, maxWaiters: 3 });
  for (const value of ["0", "100001", "1.5"]) number(value);
  expect(resource().cdnCachePolicy).toMatchObject({ maxWaiters: 3 });
  toggle(false); expect(resource().cdnCachePolicy).toEqual({ version: 2, coalesce: false, ttlSeconds: 25 });
  number("60", true); expect(resource().cdnCachePolicy).toEqual({ version: 2, coalesce: false, ttlSeconds: 60 });
  toggle(true); number("2"); number(""); expect(resource().cdnCachePolicy).toEqual({ version: 2, coalesce: true, ttlSeconds: 60 });
  number("", true); expect(resource().cdnCachePolicy).toEqual({ version: 2, coalesce: true });
});

for (const lock of ["liveLocked", "isDeploying"] as const) test(`coalescing controls honor ${lock}`, () => {
  useCanvasStore.getState().loadLayout([cdn], [], "layout", "CDN"); useCanvasStore.setState({ [lock]: true });
  toggle(false); number("2"); expect(resource().cdnCachePolicy).toBeUndefined();
  const html = renderToStaticMarkup(<CdnCoalescingControls resource={cdn} disabled />);
  expect(html.match(/disabled=""/g)).toHaveLength(2);
});

for (const policy of [{ version: 2, coalesce: true }, { version: 2, coalesce: false, ttlSeconds: 60 }, { version: 2, coalesce: true, maxWaiters: 3, ttlSeconds: 1 }] satisfies CdnCachePolicy[]) test(`v2 controls save/reload: ${JSON.stringify(policy)}`, async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([{ ...cdn, cdnCachePolicy: policy }], [], "layout", "CDN");
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "CDN" } } });
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[] } };
    expect(payload.layout.resources[0]!.cdnCachePolicy).toEqual(policy);
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "CDN");
    expect(resource().cdnCachePolicy).toEqual(policy);
  } finally { saved.mockRestore(); }
});
