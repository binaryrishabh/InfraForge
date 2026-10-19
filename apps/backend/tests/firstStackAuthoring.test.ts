import { expect, test } from "bun:test";
import { reviewSidecar } from "../firstStack/authoring";
import { createFirstStackService } from "../firstStack/service";
import type { FirstStackDesign, FirstStackRepository } from "../firstStack/service";
import { designRevision } from "../firstStack/canonical";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import { firstStackFixture } from "./firstStackFixture";

for (const apps of [1, 2, 8]) for (const cache of [false, true]) test(`${apps} apps, cache ${cache}: scope is explicit`, () => {
  const f = firstStackFixture(apps, cache), result = reviewSidecar(f.layout, f.sidecar);
  expect(result.ok).toBe(!cache);
  if (cache) expect(result.diagnostics.some(d => d.code === "CACHE_DEFERRED")).toBe(true);
  else if (result.ok) expect(result.executable).toBe(false);
});
test("legacy fields and geometry round-trip; capacity/security are never inferred", () => {
  const { layout, sidecar } = firstStackFixture();
  const saved = { ...layout, resources: layout.resources.map(r => ({ ...r, legacy: { nested: [1, "kept"] } })), oldLayoutData: { original: true }, firstStack: sidecar };
  expect<unknown>(LayoutSchema.parse(saved)).toEqual(saved);
  const result = reviewSidecar(saved, { ...sidecar, designRevision: designRevision(saved) });
  expect(result.ok).toBe(false);
  expect(result.diagnostics.some(d => d.path.endsWith("legacy"))).toBe(true);
  expect(reviewSidecar(layout, sidecar).ok).toBe(true);
});
test("missing app, transport, host and stale/ambiguous bindings produce field diagnostics", () => {
  for (const change of ["app", "path", "host", "owner", "stale", "duplicate", "port", "listener", "caller", "initial", "direction", "security", "autoscaling"] as const) {
    const f = firstStackFixture();
    if (change === "app") delete (f.sidecar.nodes[1] as Partial<typeof f.sidecar.nodes[number]>).workers;
    if (change === "path") f.sidecar.paths.length = 0;
    if (change === "host") f.sidecar.placement.length = 0;
    if (change === "owner") f.sidecar.nodes[1]!.owner = "relational";
    if (change === "stale") f.sidecar.designRevision = "0".repeat(64);
    if (change === "duplicate") f.layout.resources.push(f.layout.resources[0]!);
    if (change === "port") f.sidecar.paths[0]!.port++;
    if (change === "listener") f.sidecar.nodes[1]!.listenerPort++;
    if (change === "caller") f.sidecar.caller.entry = "db";
    if (change === "initial") f.sidecar.database.initial[0]!.key = "outside";
    if (change === "direction") f.layout.connectionLines[0]!.targetId = "db";
    if (change === "security") Object.assign(f.layout.resources[0]!, { encryption: true });
    if (change === "autoscaling") Object.assign(f.layout.resources[0]!, { autoscaling: { enabled: true } });
    expect(reviewSidecar(f.layout, f.sidecar).ok).toBe(false);
    expect(reviewSidecar(f.layout, f.sidecar).diagnostics.length).toBeGreaterThan(0);
  }
});
test("shared-host Unknown reservations refuse, explicit fitting reservations admit", () => {
  const f = firstStackFixture();
  f.sidecar.nodes[1]!.host = "host-app-0"; f.sidecar.nodes[2]!.host = "host-app-0";
  f.sidecar.placement = f.sidecar.placement.filter(h => h.id !== "host-app-1");
  expect(reviewSidecar(f.layout, f.sidecar).ok).toBe(false);
  f.sidecar.placement.find(h => h.id === "host-app-0")!.memoryBytes = 100;
  f.sidecar.nodes[1]!.reservationBytes = 50; f.sidecar.nodes[2]!.reservationBytes = 50;
  expect(reviewSidecar(f.layout, f.sidecar).ok).toBe(true);
  f.sidecar.nodes[2]!.reservationBytes = 51;
  expect(reviewSidecar(f.layout, f.sidecar).ok).toBe(false);
});
test("measured demand requires method, conditions, uncertainty and fit/holdout identity", () => {
  const f = firstStackFixture(); f.sidecar.application.origin = "measured";
  expect(reviewSidecar(f.layout, f.sidecar).ok).toBe(false);
  f.sidecar.application.measurement = { uncertainty: "Unknown", fitIdentity: "test-fit", holdoutIdentity: null, conditions: "test-only", cpuMethod: "thread-core-time" };
  const review = reviewSidecar(f.layout, f.sidecar);
  expect(review.ok).toBe(true);
  if (review.ok) expect(review.claims.timing).toBe("assumption-only");
});
export function authoringRepository() {
  const fixture = firstStackFixture();
  const row: FirstStackDesign = { id: "00000000-0000-4000-8000-000000000001", name: "Original", ownerId: "owner", updatedAt: new Date("2026-10-20T00:00:00Z"), challengeId: null, layout: fixture.layout };
  let writes = 0;
  const repo: FirstStackRepository = { transaction: async task => task({
    owned: async (id, owner) => id === row.id && owner === row.ownerId ? structuredClone(row) : null,
    update: async (_id, _owner, layout) => { writes++; row.layout = structuredClone(layout); return structuredClone(row); },
    create: async next => { writes++; return { ...structuredClone(row), ...structuredClone(next) }; },
  }) };
  return { ...fixture, row, repo, writes: () => writes };
}
test("owned revision review is read-only; immutable sidecar save is idempotent; upgrade is a reviewed copy", async () => {
  const f = authoringRepository(), service = createFirstStackService(f.repo), at = f.row.updatedAt.toISOString();
  const original = structuredClone(f.row.layout);
  expect((await service.review("owner", f.row.id, at, f.sidecar)).ok).toBe(true);
  expect(f.writes()).toBe(0);
  await expect(service.save("other", f.row.id, at, f.sidecar, false)).rejects.toThrow("not available");
  await expect(service.save("owner", f.row.id, "2020-01-01T00:00:00.000Z", f.sidecar, false)).rejects.toThrow("changed");
  await service.save("owner", f.row.id, at, f.sidecar, false);
  expect(f.row.layout).toEqual({ ...original, firstStack: f.sidecar });
  await service.save("owner", f.row.id, at, f.sidecar, false);
  expect(f.writes()).toBe(1);
  const changed = structuredClone(f.sidecar); changed.nodes[1]!.workers++;
  await expect(service.save("owner", f.row.id, at, changed, false)).rejects.toThrow("immutable");
  const copy = await service.save("owner", f.row.id, at, changed, true);
  expect(copy.id).not.toBe(f.row.id);
  expect(copy.layout).toMatchObject({ ...original, firstStack: { migration: { kind: "reviewed-copy", fromInfrastructureId: f.row.id, reviewedBy: "owner" } } });
  expect(f.row.layout).toEqual({ ...original, firstStack: f.sidecar });
});
test("semantic refusal, fixed challenge and commercial denial have no writer effects", async () => {
  const f = authoringRepository(), at = f.row.updatedAt.toISOString();
  const service = createFirstStackService(f.repo, () => { throw Error("Denied"); });
  await expect(service.save("owner", f.row.id, at, f.sidecar, false)).rejects.toThrow("Denied");
  await expect(service.save("owner", f.row.id, at, {}, false)).rejects.toThrow("refused");
  f.row.challengeId = "fixed";
  await expect(service.save("owner", f.row.id, at, f.sidecar, false)).rejects.toThrow("Fixed challenge");
  expect(f.writes()).toBe(0);
});
