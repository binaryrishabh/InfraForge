import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { Resource, CachePolicy } from "@infraforge/domain/resource";
import { CachePolicySection } from "../src/features/canvas/components/inspector/CachePolicySection";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const cache: Resource = { id: "cache", type: "Cache", x: 0, y: 0 };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });

test("cache inspector exposes bounded logical entry capacity with an honest default", () => {
  const html = renderToStaticMarkup(<CachePolicySection resource={cache} disabled={false} />);
  expect(html).toContain("Logical cache capacity"); expect(html).toContain('max="1000"'); expect(html).toContain('placeholder="Default"');
  expect(html).toContain("Educational entry budget, including modeled row bytes and per-entry overhead; provider memory is unknown. Leave blank for the existing size assumption.");
  expect(cache).not.toHaveProperty("cachePolicy");
});

test("inspector edits preserve TTL/single-flight and clearing capacity restores version 1", () => {
  useCanvasStore.getState().loadLayout([{ ...cache, cachePolicy: { version: 1, ttlSeconds: 120, singleFlight: true } }], [], "layout", "Cache");
  const edit = (label: string, value: string) => {
    const resource = useCanvasStore.getState().resources[0]!;
    const tree = CachePolicySection({ resource, disabled: false });
    type InputField = ReactElement<{ label: string; children: (ids: { id: string; invalid: boolean }) => ReactElement<{ onChange: (event: { target: { value: string } }) => void }> }>;
    const fields = tree.props.children.props.children as InputField[];
    const field = fields.find(f => f.props.label === label)!;
    field.props.children({ id: "cache-test", invalid: false }).props.onChange({ target: { value } });
  };
  edit("Logical cache capacity", "10");
  expect(useCanvasStore.getState().resources[0]!.cachePolicy).toEqual({ version: 2, capacityEntries: 10, ttlSeconds: 120, singleFlight: true });
  edit("Cache TTL", "1");
  expect(useCanvasStore.getState().resources[0]!.cachePolicy).toEqual({ version: 2, capacityEntries: 10, ttlSeconds: 1, singleFlight: true });
  edit("Logical cache capacity", "");
  expect(useCanvasStore.getState().resources[0]!.cachePolicy).toEqual({ version: 1, ttlSeconds: 1, singleFlight: true });
  undo(); expect(useCanvasStore.getState().resources[0]!.cachePolicy).toEqual({ version: 1, ttlSeconds: 120, singleFlight: true });
  redo(); expect(useCanvasStore.getState().resources[0]!.cachePolicy).toEqual({ version: 1, ttlSeconds: 1, singleFlight: true });
});

for (const lock of ["liveLocked", "isDeploying"] as const) test(`capacity preserves policy and obeys ${lock}`, () => {
  const policy: CachePolicy = { version: 2, capacityEntries: 10, ttlSeconds: 120, singleFlight: true };
  useCanvasStore.getState().loadLayout([cache], [], "layout", "Cache");
  updateResource("cache", { cachePolicy: policy }); undo(); expect(useCanvasStore.getState().resources[0]!.cachePolicy).toBeUndefined();
  redo(); expect(useCanvasStore.getState().resources[0]!.cachePolicy).toEqual(policy);
  for (const capacityEntries of [0, 1.5, 1001]) updateResource("cache", { cachePolicy: { ...policy, capacityEntries } });
  expect(useCanvasStore.getState().resources[0]!.cachePolicy).toEqual(policy);
  useCanvasStore.setState({ [lock]: true });
  updateResource("cache", { cachePolicy: { ...policy, capacityEntries: 100 } });
  const saved = useCanvasStore.getState().resources[0]!; expect(saved.cachePolicy).toEqual(policy);
  const html = renderToStaticMarkup(<CachePolicySection resource={saved} disabled />);
  expect(html).toContain('value="10"'); expect(html.match(/disabled=""/g)).toHaveLength(3);
});

test("saved version 2 capacity and existing policies survive save/reload", async () => {
  const cachePolicy: CachePolicy = { version: 2, capacityEntries: 100, ttlSeconds: 1, singleFlight: true };
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([{ ...cache, cachePolicy }], [], "layout", "Cache");
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "Cache" } } });
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[]; connectionLines: [] } };
    expect(payload.layout.resources[0]!.cachePolicy).toEqual(cachePolicy);
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Cache");
    expect(useCanvasStore.getState().resources[0]!.cachePolicy).toEqual(cachePolicy);
  } finally { saved.mockRestore(); }
});
