import { expect, test } from "bun:test";
import { apiGateway } from "../src/model2/gateway/run";
import { EventKernel } from "../src/model2/time";
import { prepare, design } from "./asyncCanvas.fixture";
import type { GatewayConfig, GatewayReply } from "../src/model2/gateway/contracts";
import type { Invocation, RemoteCompletion } from "../src/model2/workload/contracts";

function setup(hang = false) {
  const broker = prepare(design()).compiled.input.resources.find(r => r.kind === "delivery-queue")!; if (broker.kind !== "delivery-queue") throw Error("queue");
  const q = <U extends "bytes" | "count" | "us">(value: number, unit: U) => ({ kind: "known" as const, value, unit, provenance: ["test"] });
  const config: GatewayConfig = { ...broker, demands: { route: broker.demands.publish! }, id: "gateway", kind: "api-gateway", profile: "exact-route-gateway/1", maxInFlight: q(2, "count"), maxRequestBytes: q(100, "bytes"), upstreamTimeout: q(1000, "us"), routes: [{ id: "orders", path: "/orders", method: "GET", target: "orders", burst: q(1, "count"), refillEvery: q(1000000, "us") }, { id: "payments", path: "/payments", method: "POST", target: "payments", burst: q(10, "count"), refillEvery: q(1000000, "us") }] };
  const clock = new EventKernel(100000), calls: Array<{ target: string; done: RemoteCompletion; work: Invocation }> = []; let fail = false, sequence = 0;
  const gateway = apiGateway(config, clock, (target, work, done) => {
    calls.push({ target, work, done }); if (!hang) done(fail ? "rejected" : "completed");
    return { admitted: true, state: () => hang ? "waiting" : "finished", cancel: () => "unsupported" };
  });
  const send = (path: string, method = "GET", bytes = 100) => {
    const id = JSON.stringify(["request", sequence++]); const work: Invocation = { rootId: id, callId: id, attempt: 1, offeredAt: clock.now, operation: "write", message: { request: { kind: "gateway-request", path, method }, bodyBytes: { request: bytes } } }; let completions = 0;
    const receipt = gateway.accept(work, () => completions++); clock.advanceTo(clock.now + 200);
    return { work, reply: () => work.message!.response as GatewayReply, completions: () => completions, receipt };
  };
  return { clock, gateway, calls, send, fail: () => { fail = true; } };
}
test("exact routes dispatch different upstreams and route budgets do not interfere", () => {
  const f = setup(); expect(f.send("/orders").reply().status).toBe(200);
  expect(f.send("/orders").reply().status).toBe(429);
  expect(f.send("/payments", "POST").reply().status).toBe(200);
  expect(f.calls.map(c => c.target)).toEqual(["orders", "payments"]);
  expect(f.calls[1]!.work.operation).toBe("write");
  f.clock.advanceTo(1000000); expect(f.send("/orders").reply().status).toBe(200);
});
test("validation, missing route and upstream failure have different real outcomes", () => {
  const f = setup();
  expect(f.send("/orders", "DELETE").reply().status).toBe(400);
  expect(f.send("/orders", "GET", 101).reply().status).toBe(400);
  expect(f.send("/missing").reply().status).toBe(404);
  expect(f.send("/orders/child").reply().status).toBe(404);
  f.fail(); expect(f.send("/payments", "POST").reply().status).toBe(502);
  expect(f.gateway.evidence()).toMatchObject({ invalid: 2, missingRoute: 2, upstreamFailed: 1, completed: 0, pending: 0 });
});
test("bounded outstanding requests time out once and late completions cannot double count", () => {
  const f = setup(true), a = f.send("/payments", "POST"), b = f.send("/payments", "POST");
  expect(f.send("/payments", "POST").reply().status).toBe(503);
  expect(f.gateway.evidence().pending).toBe(2); f.clock.advanceTo(2000);
  expect(a.reply().status).toBe(504); expect(b.reply().status).toBe(504);
  for (const c of f.calls) { c.done("completed"); c.done("completed"); }
  expect(a.completions()).toBe(1); expect(b.completions()).toBe(1);
  expect(f.gateway.evidence()).toMatchObject({ pending: 0, timedOut: 2, completed: 0 });
});
test("same input and clock produce deterministic replay with independent gateway counters", () => {
  const a = setup(), b = setup();
  for (const f of [a, b]) { f.send("/orders"); f.send("/orders"); f.clock.advanceTo(1000000); f.send("/orders"); }
  expect(a.gateway.evidence()).toEqual(b.gateway.evidence());
  a.send("/payments", "POST"); expect(a.gateway.evidence().received).toBe(b.gateway.evidence().received + 1);
});
