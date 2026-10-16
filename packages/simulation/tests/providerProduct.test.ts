import { expect, test } from "bun:test";
import { compileProviderProduct } from "../src/reality/provider/compile";
import { createProviderModel2, providerEvidence } from "../src/reality/provider/run";
import { validateSnapshot } from "../src/reality/provider/facts";
import { locationIndex, relation } from "../src/reality/provider/locations";
import { ec2Snapshot } from "../src/reality/provider/snapshot";
import { providerFixture, providerHasher } from "./providerFixture";
const compile = (f: ReturnType<typeof providerFixture>) => compileProviderProduct(f, f.provider, f.snapshot, providerHasher);
const run = (f: ReturnType<typeof providerFixture>, at = 120000) => {
  const r = createProviderModel2(compile(f), providerHasher);

  r.advanceTo(at);

  return { runtime: r, evidence: r.evidence() };
};
test("saved product compiles through sourced capabilities without mutating authored input", () => {
  const f = providerFixture(), before = JSON.stringify(f), c = compile(f);

  expect(JSON.stringify(f)).toBe(before);

  expect(c.hosts[0]!.fact.vCpu).toBe(2);

  const main = c.product.input.resources.find((r) => r.id === "vm#0");

  expect(main?.kind === "compute" && main.cores.kind === "known" && main.cores.value).toBe(1);

  expect(main?.kind === "compute" && main.memory.policy).toBe("reject-allocation");

  expect(c.product.semantic.capabilities[0]!.value).toMatchObject({ value: 2, unit: "count" });
});
test("public raw row, publication and supported provider terms remain traceable", () => {
  const f = providerFixture();

  validateSnapshot(f.snapshot, f.provider.asOf);

  expect(f.snapshot.prices[0]!.tiers[0]!.price).toBe(f.raw.record.PricePerUnit);

  expect(f.snapshot.prices[0]!.version).toBe(f.raw.metadata.Version);

  for (const key of ["Currency", "Operating System", "Tenancy", "Pre Installed S/W", "Unit", "CapacityStatus"]) {
    const bad = JSON.parse(JSON.stringify(f.raw));

    bad.record[key] = "unsupported";

    expect(() => ec2Snapshot(bad, f.reviews)).toThrow();
  }
});
test("unknown SKU/fact, capability oversubscription and orphan/missing partitions refuse", () => {
  for (const mutate of [
    (f: ReturnType<typeof providerFixture>) => {
      f.design.resources.find((r) => r.id === "vm")!.skuId = "unknown";
    },

    (f: ReturnType<typeof providerFixture>) => {
      f.provider.hosts[0]!.fact = "unknown";
    },

    (f: ReturnType<typeof providerFixture>) => {
      f.provider.hosts[0]!.roles.pop();
    },

    (f: ReturnType<typeof providerFixture>) => {
      f.provider.hosts[0]!.roles[0]!.memory = f.q.q("too-large", 9 * 1024 ** 3, "bytes");
    },

    (f: ReturnType<typeof providerFixture>) => {
      const r = f.contract.nodes.vm!.resources[0]!.config;

      if (r.kind === "compute") r.cores = f.q.q("too-many-cores", 3, "cores");
    },
  ]) {
    const f = providerFixture();

    mutate(f);

    expect(() => compile(f)).toThrow();
  }
});
test("snapshot/version/publication/review drift never silently reinterprets input", () => {
  for (const mutate of [
    (f: ReturnType<typeof providerFixture>) => {
      f.provider.snapshot = "next";
    },

    (f: ReturnType<typeof providerFixture>) => {
      f.provider.asOf = "2026-12-01T00:00:00Z";
    },

    (f: ReturnType<typeof providerFixture>) => {
      f.snapshot.sources[0]!.publicationDate = "2027-01-01T00:00:00Z";
    },

    (f: ReturnType<typeof providerFixture>) => {
      f.snapshot.sources.push(f.snapshot.sources[0]!);
    },

    (f: ReturnType<typeof providerFixture>) => {
      f.snapshot.locations[1]!.parent = f.snapshot.locations[1]!.id;
    },

    (f: ReturnType<typeof providerFixture>) => {
      f.provider.asOf = "2026-02-30T00:00:00Z";
    },
  ]) {
    const f = providerFixture();

    mutate(f);

    expect(() => compile(f)).toThrow();
  }
});
test("stable zones, hierarchy and explicit placement constraints; no name-based latency", () => {
  const f = providerFixture();

  expect(relation(f.snapshot.locations, "aws:aws:use1-az1", "aws:aws:use1-az2")).toBe("same-region");

  expect(relation(f.snapshot.locations, undefined, "aws:aws:use1-az1")).toBe("Unknown");

  expect(locationIndex(f.snapshot.locations).contains("aws:aws:us-east-1", "aws:aws:use1-az2")).toBe(true);

  f.provider.hosts[0]!.placements[1]!.location = "aws:aws:use1-az1";

  expect(() => compile(f)).toThrow("relationship");

  f.provider.hosts[0]!.placements[1]!.location = "us-east-1a";

  expect(() => compile(f)).toThrow();
});
test("canonical provider spec ignores fact/role/placement declaration order", () => {
  const f = providerFixture(), before = compile(f);

  f.snapshot.sources.reverse();

  f.snapshot.locations.reverse();

  f.provider.hosts[0]!.placements.reverse();

  f.provider.hosts[0]!.roles.reverse();

  expect(compile(f)).toEqual(before);
});
test("real memory admission consequence follows the authored partition, not SKU throughput", () => {
  const normal = run(providerFixture()).evidence, small = run(providerFixture({ memory: 100 })).evidence;

  const rejected = (e: typeof normal) => e.model.resources.filter((r) => /^vm#\d+$/.test(r.id)).reduce((a, r) => a + (r.compute?.allocationRejected ?? 0), 0);

  expect(rejected(small)).toBeGreaterThan(rejected(normal));

  expect(small.model.counts.completed).toBeLessThan(normal.model.counts.completed);

  expect(small.provider.total.kind).toBe("Unknown");
});
test("allocation usage includes real image/startup and idle time, excludes dormant slots", () => {
  const { evidence, runtime } = run(providerFixture());

  expect(evidence.provider.usage.rows.length).toBeGreaterThan(0);

  expect(evidence.provider.selectedComputeSubtotal.kind).toBe("Estimated");

  const pool = evidence.model.product.controllers[0]!;

  for (const row of evidence.provider.usage.rows) {
    const replica = pool.replicas.find((r) => r.id === row.resource)!;

    expect(row.fromUs).toBeLessThan(replica.readyAt!);

    expect(row.quantity.numerator).toBe(String(row.toUs - row.fromUs));
  }

  expect(evidence.provider.usage.rows.length).toBeLessThan(pool.replicas.length);

  expect(runtime.presentation().values["cost.total"]!.kind).toBe("Unknown");
});
test("zone incident changes only selected members; region incident covers both zones", () => {
  const zone = run(providerFixture({ domain: "zone", min: 2, slots: 2 }), 70000).evidence;

  const region = run(providerFixture({ domain: "region", min: 2, slots: 2 }), 70000).evidence;

  const state = (e: typeof zone, id: string) => e.model.product.controllers[0]!.replicas.find((r) => r.id === id)!.endpoint;

  expect(state(zone, "vm#0").alive).toBe(false);

  expect(state(zone, "vm#1").alive).toBe(true);

  expect(state(region, "vm#0").alive).toBe(false);

  expect(state(region, "vm#1").alive).toBe(false);

  expect(zone.provider.domainEffects[0]!.targets).toEqual(["vm#0"]);

  expect(region.model.counts.completed).toBeLessThan(zone.model.counts.completed);
});
test("process loss and artifact retry do not terminate billed allocation", () => {
  const f = providerFixture({ domain: "zone", min: 2, slots: 2 }), c = compile(f), r = createProviderModel2(c, providerHasher);

  r.advanceTo(95000);

  const e = r.evidence();

  expect(e.model.product.controllers[0]!.replicas[0]!.endpoint.ready).toBe(true);

  expect(e.provider.usage.rows[0]!.toUs).toBe(95000);

  const retry = run(providerFixture({ registryOutage: true })).evidence;

  expect(retry.provider.usage.rows.length).toBeGreaterThan(0);

  expect(retry.provider.usage.unknown).toEqual([]);
});
test("omitted lifecycle evidence and unpriced allocation stay Unknown", () => {
  const f = providerFixture(), c = compile(f), r = createProviderModel2(c, providerHasher);

  r.advanceTo(120000);

  const e = r.evidence().model;

  e.product.controllers[0]!.omitted = 1;

  expect(providerEvidence(c, e).selectedComputeSubtotal.kind).toBe("Unknown");

  f.provider.hosts[0]!.price = null;

  const unpriced = run(f).evidence.provider;
  expect(unpriced.selectedComputeSubtotal.kind).toBe("Unknown");
  expect(unpriced.usage.rows.length).toBeGreaterThan(0);
  expect(unpriced.usage.unknown).toEqual([]);
});
test("location labels alone leave compiled transport and arrivals unchanged", () => {
  const a = providerFixture(), b = providerFixture();

  b.provider.hosts[0]!.placements.forEach((p) => {
    p.location = p.location.endsWith("az1") ? "aws:aws:use1-az2" : "aws:aws:use1-az1";
  });

  const x = compile(a), y = compile(b);

  expect(y.product.input.links).toEqual(x.product.input.links);

  expect(y.product.input.arrivals).toEqual(x.product.input.arrivals);
});
test("same-version fact drift and post-compile mutation require explicit recompilation", () => {
  const f = providerFixture();

  f.snapshot.instances[0]!.vCpu = 64;

  expect(() => compile(f)).toThrow("content drift");

  const c = compile(providerFixture());

  c.facts.prices[0]!.tiers[0]!.price = "0";

  expect(() => createProviderModel2(c, providerHasher)).toThrow("content drift");
  const valid = providerFixture();
  expect(() => compileProviderProduct(valid, valid.provider, valid.snapshot, { ...providerHasher, hash: () => "invalid" })).toThrow("hash result");
});
test("partial resident memory, hidden host roles and insufficient cache reservation refuse", () => {
  const f = providerFixture(), cpu = f.contract.nodes.vm!.resources[0]!.config;

  if (cpu.kind === "compute") cpu.memory.coverage = "partial";

  expect(() => compile(f)).toThrow("complete");

  const g = providerFixture();

  g.provider.hosts[0]!.roles.find((r) => r.role === "image")!.memory = g.q.q("insufficient-image-memory", 1, "bytes");

  expect(() => compile(g)).toThrow("cache bytes");
});
test("manual scale-in closes actual allocation only on termination", () => {
  const f = providerFixture(), controller = f.contract.nodes.vm!.controller!;

  controller.initial = f.q.q("provider.initial.two", 2, "count");

  controller.cooldown = f.q.q("provider.manual.cooldown", 120000, "us");

  controller.manual.push({
    id: "hold",

    at: f.q.q("provider.hold.at", 0, "us"),

    desired: f.q.q("provider.hold.desired", 2, "count")
  });

  controller.manual.push({
    id: "reduce",

    at: f.q.q("provider.reduce.at", 100000, "us"),

    desired: f.q.q("provider.reduce.desired", 1, "count")
  });

  const e = run(f).evidence, stopped = e.model.product.controllers[0]!.events.find((v) => v.kind === "terminated")!;

  expect(stopped).toBeDefined();

  expect(e.provider.usage.rows.find((r) => r.resource === stopped.id)!.toUs).toBe(stopped.at);

  expect(stopped.at).toBeGreaterThanOrEqual(100000);
});
test("failed provisioning is unallocated; pending-only observed usage is a justified zero subtotal", () => {
  const f = providerFixture(), controller = f.contract.nodes.vm!.controller!;

  controller.initial = f.q.q("provider.initial.failed", 2, "count");

  controller.provisionFailures = [1];

  const e = run(f).evidence;

  expect(e.provider.usage.rows.some((r) => r.resource === "vm#1")).toBe(false);

  const pending = run(providerFixture(), 100).evidence.provider;

  expect(pending.selectedComputeSubtotal).toMatchObject({ kind: "Estimated", amount: { numerator: "0", denominator: "1" } });

  expect(pending.total.kind).toBe("Unknown");
});
test("large slot counts refuse before allocation and unsupported domain fate is not invented", () => {
  const f = providerFixture();

  f.contract.nodes.vm!.controller!.slots = f.q.q("huge.slot.budget", 1000000000, "count");

  expect(() => compile(f)).toThrow("slot budget");

  const g = providerFixture({ domain: "zone" });

  g.provider.faults[0]!.nodes = ["objects"];

  expect(() => compile(g)).toThrow("managed-service fate is Unknown");
});
test("two pools share a reviewed capability fact without duplicate provenance or charges", () => {
  const f = providerFixture(), original = f.design.resources.find((r) => r.id === "vm")!;
  f.design.resources.push({ ...original, id: "vm2" });
  const profile = JSON.parse(JSON.stringify(f.contract.nodes.vm!)) as typeof f.contract.nodes[string];
  profile.controller!.artifact.node = "vm2";
  let address = 200;
  for (const identity of profile.identities) identity.address = Array.from({ length: 4 }, () => `192.0.2.${address++}`).join(",");
  f.contract.nodes.vm2 = profile;
  f.design.connections.push({ ...f.design.connections.find((r) => r.id === "route")!, id: "route2", targetId: "vm2" });
  f.contract.edges.route2 = JSON.parse(JSON.stringify(f.contract.edges.route!));
  for (const edge of f.design.connections.filter((r) => r.sourceId === "vm")) {
    f.design.connections.push({ ...edge, id: `${edge.id}2`, sourceId: "vm2" });
    f.contract.edges[`${edge.id}2`] = JSON.parse(JSON.stringify(f.contract.edges[edge.id]!));
  }
  const host = JSON.parse(JSON.stringify(f.provider.hosts[0]!)) as typeof f.provider.hosts[number];
  host.node = "vm2";
  host.placements.forEach((p) => { p.instance = p.instance.replace("vm#", "vm2#"); });
  f.provider.hosts.push(host);
  const c = compile(f), r = createProviderModel2(c, providerHasher);
  expect(c.product.input.ledger.filter((l) => l.id.startsWith("m2i.") && l.concept === "vCpu")).toHaveLength(1);
  r.advanceTo(120000);
  const e = r.evidence();
  expect(e.provider.usage.rows.some((u) => u.resource.startsWith("vm2#"))).toBe(true);
  expect(e.provider.selectedComputeSubtotal.kind).toBe("Estimated");
});
