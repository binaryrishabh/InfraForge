import { requireKnown } from "../../reality/quantity";
import { commandService } from "../async/commands";
import { tokenBucketState, takeToken, projectTokens } from "../composition/token-bucket-core";
import type { Deliver } from "../compute/run";
import type { EventKernel } from "../time";
import type { Invocation, Receipt, RemoteCompletion } from "../workload/contracts";
import type { Cause } from "../workload/cause";
import { carryCause } from "../workload/cause";
import type { GatewayConfig, GatewayReply, GatewayRequest } from "./contracts";

export function apiGateway(config: GatewayConfig, clock: EventKernel, send: Deliver) {
  const maxInFlight = requireKnown(config.maxInFlight, "count"), maxBytes = requireKnown(config.maxRequestBytes, "bytes"), timeout = requireKnown(config.upstreamTimeout, "us");
  const routes = config.routes.map(route => ({ ...route, state: tokenBucketState(requireKnown(route.burst, "count"), requireKnown(route.burst, "count"), 1, requireKnown(route.refillEvery, "us"), clock.now) }));
  const live = new Map<string, () => void>();
  const service = commandService(config.id, config, clock, () => ({ ok: true }));
  let received = 0, admitted = 0, completed = 0, invalid = 0, missingRoute = 0, throttled = 0, overloaded = 0, gatewayFailed = 0, upstreamFailed = 0, timedOut = 0, cancelled = 0, paused = false;
  const events: Array<{ atUs: number; route: string | null; status: number }> = []; let omitted = 0;
  const record = (reply: GatewayReply) => { if (events.length < 2048) events.push({ atUs: clock.now, route: reply.route ?? null, status: reply.status }); else omitted++; };
  const respond = (work: Invocation, done: RemoteCompletion, reply: GatewayReply, cause?: Cause) => { work.message ??= {}; work.message.response = reply; record(reply); done(reply.ok ? "completed" : "rejected", cause ? carryCause(cause) : undefined); };
  const refusal = (work: Invocation, done: RemoteCompletion, status: GatewayReply["status"], reason: string, route?: string): Receipt => {
    respond(work, done, { ok: false, status, reason, ...(route ? { route } : {}) });
    return { admitted: false, state: () => "finished", cancel: () => "already-finished" };
  };
  return {
    accept(work: Invocation, done: RemoteCompletion): Receipt {
      received++;
      const request = work.message?.request as GatewayRequest | undefined;
      const path = request?.path ?? `/${work.operation}`, method = request?.method ?? (work.operation === "write" ? "POST" : "GET"), bytes = work.message?.bodyBytes?.request ?? 0;
      if ((request !== undefined && (!request || typeof request !== "object" || Array.isArray(request) || request.kind !== "gateway-request" || request.path === undefined || request.method === undefined || Object.keys(request).some(k => !["kind", "path", "method"].includes(k)))) || typeof path !== "string" || path.length > 256 || !/^\/[a-zA-Z0-9/_-]*$/.test(path) || !["GET", "POST"].includes(method) || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxBytes) { invalid++; return refusal(work, done, 400, "invalid-request"); }
      const route = routes.find(r => r.path === path && (r.method === "ANY" || r.method === method));
      if (!route) { missingRoute++; return refusal(work, done, 404, "missing-route"); }
      if (paused || live.size >= maxInFlight || live.has(work.callId)) { overloaded++; return refusal(work, done, 503, "gateway-capacity", route.id); }
      const token = takeToken(route.state, clock.now); route.state = token.state;
      if (!token.admitted) { throttled++; return refusal(work, done, 429, "route-throttled", route.id); }
      admitted++; let terminal = false, receipt: Receipt | undefined, cancelDispatch: (() => boolean) | undefined;
      const finish = (reply: GatewayReply, cause?: Cause, cancel = false) => {
        if (terminal) return; terminal = true; cancelTimeout(); cancelDispatch?.(); live.delete(work.callId);
        if (cancel) cancelled++; else if (reply.ok) completed++; else if (reply.status === 504) timedOut++; else if (reply.status === 503) gatewayFailed++; else upstreamFailed++;
        if (cancel) { work.message ??= {}; work.message.response = reply; record(reply); done("cancelled"); }
        else respond(work, done, reply, cause);
      };
      const cancelTimeout = clock.schedule(clock.now + timeout, 1, JSON.stringify(["gateway-timeout", config.id, work.callId]), () => { finish({ ok: false, status: 504, reason: "upstream-timeout-ambiguous", route: route.id }); receipt?.cancel(); });
      live.set(work.callId, () => { finish({ ok: false, status: 503, reason: "cancelled", route: route.id }, undefined, true); receipt?.cancel(); });
      const command = { ...work, message: { request: { kind: "route" } } };
      receipt = service.accept(command, outcome => {
        if (terminal) return;
        if (outcome !== "completed") { finish({ ok: false, status: 503, reason: "gateway-unavailable", route: route.id }); return; }
        cancelDispatch = clock.schedule(clock.now, 2, JSON.stringify(["gateway-forward", config.id, work.callId]), () => {
          const child: Invocation = { ...work, parentCallId: work.callId, callId: JSON.stringify(["gateway", config.id, work.callId, route.id]), ...(work.message ? { message: { request: work.message.request, bodyBytes: work.message.bodyBytes } } : {}) };
          receipt = send(route.target, child, (result, cause) => finish({ ok: result === "completed", status: result === "completed" ? 200 : 502, reason: result === "completed" ? "upstream-completed" : "upstream-failed", route: route.id, ...(child.message?.response === undefined ? {} : { upstream: child.message.response }) }, cause));
        });
      });
      return { admitted: true, state: () => terminal ? "finished" : "waiting", cancel() { if (terminal) return "already-finished"; live.get(work.callId)!(); return "cancelled"; } };
    },
    pause(value: boolean) { paused = value; service.pause(value); },
    measure: () => ({ id: config.id, paused, received, admitted, rejected: received - admitted, completed, failed: upstreamFailed + timedOut + gatewayFailed, cancelled, queued: 0, serving: 0, waiting: live.size, consumedCoreUs: service.measure().consumedCoreUs, busySlotUs: service.measure().busySlotUs }),
    evidence: () => ({ id: config.id, received, admitted, completed, invalid, missingRoute, throttled, overloaded, gatewayFailed, upstreamFailed, timedOut, cancelled, pending: live.size, routes: routes.map(r => ({ id: r.id, target: r.target, path: r.path, method: r.method, ...projectTokens(r.state, clock.now) })), events: events.map(e => ({ ...e })), omitted, service: service.evidence(), authentication: "Unknown; no authentication model", physicalTiming: "Unknown; authored logical command demand only" }),
  };
}
