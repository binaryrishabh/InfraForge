import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { CDN_TTL_HELP, CDN_TTL_SCOPE, type Resource } from "@infraforge/domain/resource";
import { CdnTtlSection } from "../src/features/canvas/components/inspector/CdnTtlSection";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { undo, redo } from "../src/features/canvas/history";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const cdn: Resource = { id: "cdn", type: "CDN", x: 0, y: 0 };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });
function edit(value: string) {
  const tree = CdnTtlSection({ resource: useCanvasStore.getState().resources[0]!, disabled: false });
  const field = tree.props.children[0] as ReactElement<{ children: (ids: { id: string }) => ReactElement<{ onChange: (e: { target: { value: string } }) => void }> }>;
  field.props.children({ id: "ttl-test" }).props.onChange({ target: { value } });
}

test("CDN inspector exposes TTL with bounds, blank default and policy explanation", () => {
  const html = renderToStaticMarkup(<Inspector resource={cdn} />);
  for (const text of ["Cache TTL (seconds)", CDN_TTL_HELP, CDN_TTL_SCOPE, 'min="1"', 'max="3600"', 'placeholder="60"']) expect(html).toContain(text);
  expect(cdn).not.toHaveProperty("cdnCachePolicy");
  useCanvasStore.getState().loadLayout([cdn], [], "layout", "CDN"); edit("25");
  expect(useCanvasStore.getState().resources[0]!.cdnCachePolicy).toEqual({ version: 1, ttlSeconds: 25 });
  undo(); expect(useCanvasStore.getState().resources[0]!.cdnCachePolicy).toBeUndefined();
  redo(); expect(useCanvasStore.getState().resources[0]!.cdnCachePolicy?.ttlSeconds).toBe(25);
  for (const bad of ["0", "3601", "1.5"]) edit(bad);
  expect(useCanvasStore.getState().resources[0]!.cdnCachePolicy?.ttlSeconds).toBe(25);
  edit(""); expect(useCanvasStore.getState().resources[0]!.cdnCachePolicy).toBeUndefined();
});

for (const lock of ["liveLocked", "isDeploying"] as const) test(`CDN TTL respects ${lock}`, () => {
  useCanvasStore.getState().loadLayout([cdn], [], "layout", "CDN"); useCanvasStore.setState({ [lock]: true }); edit("25");
  expect(useCanvasStore.getState().resources[0]!.cdnCachePolicy).toBeUndefined();
  expect(renderToStaticMarkup(<CdnTtlSection resource={cdn} disabled />)).toContain('disabled=""');
});

for (const cdnCachePolicy of [undefined, { version: 1 as const, ttlSeconds: 60 }, { version: 1 as const, ttlSeconds: 3600 }]) test(`CDN TTL save/reload: ${JSON.stringify(cdnCachePolicy)}`, async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([{ ...cdn, ...(cdnCachePolicy ? { cdnCachePolicy } : {}) }], [], "layout", "CDN");
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "CDN" } } });
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[] } };
    expect(payload.layout.resources[0]!.cdnCachePolicy).toEqual(cdnCachePolicy);
    if (!cdnCachePolicy) expect(payload.layout.resources[0]).not.toHaveProperty("cdnCachePolicy");
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "CDN");
    expect(useCanvasStore.getState().resources[0]!.cdnCachePolicy).toEqual(cdnCachePolicy);
  } finally { saved.mockRestore(); }
});
