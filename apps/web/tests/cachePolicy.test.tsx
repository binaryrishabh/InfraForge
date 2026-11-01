import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Resource, CachePolicy } from "@infraforge/domain/resource";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { CachePolicySection } from "../src/features/canvas/components/inspector/CachePolicySection";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const cache: Resource = { id: "cache", type: "Cache", x: 0, y: 0 };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });

test("Cache inspector exposes bounded TTL and single-flight with exact explanatory text", () => {
  const html = renderToStaticMarkup(<Inspector resource={cache} />);
  expect(html).toContain("Cache TTL"); expect(html).toContain('type="number"');
  expect(html).toContain('min="1"'); expect(html).toContain('max="3600"'); expect(html).toContain('step="1"'); expect(html).toContain('value="60"');
  expect(html).toContain("Single-flight"); expect(html).toContain('aria-checked="false"');
  expect(html).toContain("When enabled, concurrent misses for the same key share one database fill instead of independently hitting the database.");
  expect(renderToStaticMarkup(<Inspector resource={{ ...cache, type: "Database" }} />)).not.toContain("Cache TTL");
  expect(cache).not.toHaveProperty("cachePolicy");
});

for (const lock of ["liveLocked", "isDeploying"] as const) test(`Cache controls show saved values and obey ${lock}`, () => {
  useCanvasStore.setState({ [lock]: true });
  const configured: Resource = { ...cache, cachePolicy: { version: 1, ttlSeconds: 120, singleFlight: true } };
  const html = renderToStaticMarkup(<CachePolicySection resource={configured} disabled />);
  expect(html).toContain('value="120"'); expect(html).toContain('aria-checked="true"'); expect(html.match(/disabled=""/g)).toHaveLength(3);
  useCanvasStore.getState().loadLayout([configured], [], "layout", "Cache"); useCanvasStore.setState({ [lock]: true });
  updateResource("cache", { cachePolicy: { version: 1, ttlSeconds: 1, singleFlight: false } });
  expect(useCanvasStore.getState().resources[0]!.cachePolicy).toEqual(configured.cachePolicy);
});

test("Cache edits undo to absent settings, redo and refuse invalid bounds/owners", () => {
  useCanvasStore.getState().loadLayout([cache], [], "layout", "Cache");
  const policy: CachePolicy = { version: 1, ttlSeconds: 1, singleFlight: true };
  updateResource("cache", { cachePolicy: policy }); expect(useCanvasStore.getState().resources[0]!.cachePolicy).toEqual(policy);
  undo(); expect(useCanvasStore.getState().resources[0]!.cachePolicy).toBeUndefined();
  redo(); expect(useCanvasStore.getState().resources[0]!.cachePolicy).toEqual(policy);
  for (const ttlSeconds of [0, 1.5, 3601]) updateResource("cache", { cachePolicy: { version: 1, ttlSeconds } });
  expect(useCanvasStore.getState().resources[0]!.cachePolicy).toEqual(policy);
  useCanvasStore.getState().loadLayout([{ ...cache, type: "Database" }], [], "layout", "DB");
  updateResource("cache", { cachePolicy: policy }); expect(useCanvasStore.getState().resources[0]!.cachePolicy).toBeUndefined();
});

for (const cachePolicy of [undefined, { version: 1 as const, ttlSeconds: 60, singleFlight: false }, { version: 1 as const, ttlSeconds: 1, singleFlight: true }]) test(`save/reload preserves explicit settings and absence: ${JSON.stringify(cachePolicy)}`, async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([cache], [], "layout", "Cache");
  if (cachePolicy) updateResource("cache", { cachePolicy });
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "Cache" } } });
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[]; connectionLines: [] } };
    expect(payload.layout.resources[0]!.cachePolicy).toEqual(cachePolicy);
    if (!cachePolicy) expect(payload.layout.resources[0]).not.toHaveProperty("cachePolicy");
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, payload.layout.connectionLines, "layout", "Cache");
    expect(useCanvasStore.getState().resources[0]!.cachePolicy).toEqual(cachePolicy); expect(useCanvasStore.getState().undoStack).toEqual([]);
  } finally { saved.mockRestore(); }
});
