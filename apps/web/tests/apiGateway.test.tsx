import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiGatewaySection } from "../src/features/canvas/components/inspector/ApiGatewaySection";
import { GatewayReadings } from "../src/features/live/GatewayReadings";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import type { Resource } from "@infraforge/domain/resource";
afterEach(() => useCanvasStore.getState().clearCanvas());
test("gateway routes save/reload and undo/redo with run and deployment locks", () => {
  const gateway: Resource = { id: "gateway", type: "API Gateway", x: 0, y: 0 };
  useCanvasStore.setState({ resources: [gateway], undoStack: [], redoStack: [], liveLocked: false, isDeploying: false });
  const settings = { version: 1 as const, routes: [{ id: "read", edge: "edge", path: "/read", method: "GET" as const, burstRequests: 1, requestsPerSecond: 1 }] };
  updateResource("gateway", { apiGateway: settings }); undo(); expect(useCanvasStore.getState().resources[0]!.apiGateway).toBeUndefined(); redo();
  useCanvasStore.setState({ resources: JSON.parse(JSON.stringify(useCanvasStore.getState().resources)) }); expect(useCanvasStore.getState().resources[0]!.apiGateway).toEqual(settings);
  for (const lock of [{ liveLocked: true, isDeploying: false }, { liveLocked: false, isDeploying: true }]) {
    useCanvasStore.setState(lock); updateResource("gateway", { apiGateway: undefined }); expect(useCanvasStore.getState().resources[0]!.apiGateway).toEqual(settings);
  }
  useCanvasStore.setState({ liveLocked: false, isDeploying: false });
});
test("gateway controls expose bounded defaults and live outcomes preserve Unknown", () => {
  const html = renderToStaticMarkup(<ApiGatewaySection resource={{ id: "gateway", type: "API Gateway", x: 0, y: 0 }} disabled />);
  expect(html.match(/type="number"/g)).toHaveLength(3); expect(html).toContain('placeholder="1048576"'); expect(html).toContain("GET /read");
  const missing = renderToStaticMarkup(<GatewayReadings />); expect(missing).toContain("Unknown"); expect(missing).not.toContain("<dd>0</dd>");
});
