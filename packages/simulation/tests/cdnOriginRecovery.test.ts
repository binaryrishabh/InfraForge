import { expect, test } from "bun:test";
import { cdnOriginRecovery } from "./cdnOriginRecovery.fixture";
import { createSystemsModel2 } from "../src/model2/systems/run";

test("coalescing changes real origin work and network bytes during failure, recovery stampede and warm service", () => {
  const outcomes = [false, true].map(coalesce => {
    const f = cdnOriginRecovery(coalesce);
    f.runtime.advanceTo(11000);
    const failed = f.runtime.evidence();
    expect(failed.systems.cdns[0]!.entries).toEqual([]);
    expect(failed.systems.cdns[0]!.pendingFills).toEqual([]);
    expect(failed.systems.commands.results).toHaveLength(10);
    expect(failed.systems.commands.results.every(r => r.outcome === "rejected" && (r.reply as { reason: string }).reason === "origin-failed")).toBe(true);
    f.runtime.advanceTo(24000);
    const recovered = f.runtime.evidence();
    expect(recovered.systems.cdns[0]!.entries).toHaveLength(1);
    expect(recovered.systems.commands.results.filter(r => r.id.startsWith("recovered-")).every(r => r.outcome === "completed")).toBe(true);
    f.runtime.advanceTo(f.runtime.horizon);
    const e = f.runtime.evidence(), cdn = e.systems.cdns[0]!, store = e.asynchronous.objects.find(s => s.id === "objects")!;
    expect(cdn.originRequests).toBe(recovered.systems.cdns[0]!.originRequests);
    expect(cdn.hits - recovered.systems.cdns[0]!.hits).toBe(10);
    expect(cdn.pendingFills).toEqual([]);
    expect(store.gets).toBe(cdn.originRequests);
    expect(e.systems.commands.completed + e.systems.commands.failed).toBe(e.systems.commands.offered);
    const replay = createSystemsModel2(f.input);
    for (let at = 1000; at <= replay.horizon; at += 1000) replay.advanceTo(at);
    expect(replay.evidence()).toEqual(e);
    const originBytes = e.network.links.filter(l => l.id.startsWith("cdn:objects:")).reduce((n, l) => n + l.transmittedBytes, 0);
    const { offered, completed, failed: failures, live, omitted } = e.systems.commands;
    return { coalesce, failedFetches: failed.systems.cdns[0]!.originRequests, originRequests: cdn.originRequests, gets: store.gets, originBytes, counts: { offered, completed, failed: failures, live, omitted } };
  });
  expect(outcomes[1]!.failedFetches).toBeLessThan(outcomes[0]!.failedFetches);
  expect(outcomes[1]!.gets).toBeLessThan(outcomes[0]!.gets);
  expect(outcomes[1]!.originBytes).toBeLessThan(outcomes[0]!.originBytes);
  expect(outcomes[1]!.counts).toEqual(outcomes[0]!.counts);
  console.info("cdn-origin-failure-recovery", JSON.stringify(outcomes));
});

test("the same cold recovery exceeds a shared firewall table; coalescing and capacity have distinct consequences", () => {
  const outcomes = [[false, 12], [true, 12], [false, 64]] as const;
  const results = outcomes.map(([coalesce, flows]) => {
    const f = cdnOriginRecovery(coalesce, flows); f.runtime.advanceTo(f.runtime.horizon);
    const e = f.runtime.evidence();
    const recovered = e.systems.commands.results.filter(r => r.id.startsWith("recovered-"));
    expect(e.systems.security.policies[0]!.flows.length).toBeLessThanOrEqual(flows);
    expect(e.systems.commands.live).toBe(0);
    return { coalesce, flows, recovered: recovered.filter(r => r.outcome === "completed").length, denied: e.systems.security.events.rows.filter(r => r.detail?.startsWith("flow-capacity:")).length };
  });
  expect(results[0]!.denied).toBeGreaterThan(0);
  expect(results[1]!.recovered).toBeGreaterThan(results[0]!.recovered);
  expect(results[2]!.recovered).toBeGreaterThan(results[0]!.recovered);
  console.info("cdn-origin-firewall-capacity", JSON.stringify(results));
});
