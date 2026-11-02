import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Resource } from "@infraforge/domain/resource";
import { LbRateLimitSection } from "../src/features/canvas/components/inspector/LbRateLimitSection";
import { LbRateLimitReadings } from "../src/features/live/LbRateLimitReadings";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const lb: Resource = { id: "lb", type: "Load Balancer", x: 0, y: 0 };
const policy = { version: 1 as const, burstRequests: 20, sustainedRequestsPerSecond: 10 };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });

test("small LB inspector exposes optional bounded rate/burst controls and selected readings stay Unknown without evidence", () => {
  const html = renderToStaticMarkup(<Inspector resource={lb} />);
  for (const text of ["Load balancer rate limit", "Burst requests", "Sustained requests per second", 'min="0.001"', 'max="1000000"', 'max="100000"', "No limit"]) expect(html).toContain(text);
  const locked = renderToStaticMarkup(<LbRateLimitSection resource={{ ...lb, lbRateLimit: policy }} disabled />);
  expect(locked.match(/disabled=""/g)).toHaveLength(3);
  expect(renderToStaticMarkup(<LbRateLimitReadings />).match(/<dd>Unknown<\/dd>/g)).toHaveLength(6);
  const measured = renderToStaticMarkup(<LbRateLimitReadings metrics={{ version: 1, received: 30, admitted: 20, rejected: 10, availableTokens: 0, retainedRefillTokens: 0, sustainedRequestsPerSecond: 10, burstCapacity: 20 }} />);
  for (const text of ["<dt>Admitted</dt><dd>20</dd>", "<dt>Rate-limited</dt><dd>10</dd>", "<dt>Available tokens</dt><dd>0</dd>"]) expect(measured).toContain(text);
});

for (const lock of ["liveLocked", "isDeploying"] as const) test(`rate-limit edits support undo/redo and respect ${lock}`, () => {
  useCanvasStore.getState().loadLayout([lb], [], "layout", "Limiter");
  updateResource("lb", { lbRateLimit: policy }); expect(useCanvasStore.getState().resources[0]!.lbRateLimit).toEqual(policy);
  undo(); expect(useCanvasStore.getState().resources[0]!.lbRateLimit).toBeUndefined(); redo();
  for (const burstRequests of [0, 1.5, 100001]) updateResource("lb", { lbRateLimit: { ...policy, burstRequests } });
  expect(useCanvasStore.getState().resources[0]!.lbRateLimit).toEqual(policy);
  useCanvasStore.setState({ [lock]: true }); updateResource("lb", { lbRateLimit: undefined });
  expect(useCanvasStore.getState().resources[0]!.lbRateLimit).toEqual(policy);
});

test("limiter save/reload preserves explicit settings and clearing restores absence", async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([{ ...lb, lbRateLimit: policy }], [], "layout", "Limiter");
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "Limiter" } } });
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[] } };
    expect(payload.layout.resources[0]!.lbRateLimit).toEqual(policy);
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Limiter");
    expect(useCanvasStore.getState().resources[0]!.lbRateLimit).toEqual(policy);
    updateResource("lb", { lbRateLimit: undefined }); expect(useCanvasStore.getState().resources[0]!.lbRateLimit).toBeUndefined();
  } finally { saved.mockRestore(); }
});
