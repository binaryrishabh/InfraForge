import { expect, test } from "bun:test";
import { apiGatewayError, resolveApiGateway } from "../src/resource/ApiGateway.interface";
test("gateway defaults and saved route budgets are bounded and strictly owned", () => {
  expect(resolveApiGateway()).toEqual({ maxRequestBytes: 1048576, maxInFlight: 256, upstreamTimeoutMs: 1000 });
  expect(apiGatewayError("API Gateway", { version: 1, routes: [{ id: "read", edge: "e", path: "/orders", method: "GET", burstRequests: 2, requestsPerSecond: 1 }] })).toBeUndefined();
  for (const settings of [{ version: 2 }, { version: 1, auth: true }, { version: 1, maxRequestBytes: -1 }, { version: 1, maxInFlight: Infinity }, { version: 1, routes: [{ id: "r", edge: "e", path: "/x", method: "DELETE" }] }, { version: 1, routes: [{ id: "r", edge: "e", path: "/x", method: "GET" }, { id: "s", edge: "f", path: "/x", method: "ANY" }] }]) expect(apiGatewayError("API Gateway", settings)).toBeDefined();
  expect(apiGatewayError("Virtual Machine", { version: 1 })).toBeDefined();
  expect(apiGatewayError("Virtual Machine", undefined)).toBeUndefined();
});
