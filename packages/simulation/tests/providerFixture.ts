import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { CATALOG_SNAPSHOT_DATE } from "@infraforge/catalog";
import { productFixture } from "./productFixture";
import { ec2Snapshot } from "../src/reality/provider/snapshot";
import type { ProviderContract } from "../src/reality/provider/contracts";
import { snapshotFingerprint } from "../src/reality/provider/fingerprint";
import type { ContentHasher } from "../src/reality/provider/fingerprint";
export const providerHasher: ContentHasher = { algorithm: "sha256-utf8/1", hash: (text) => createHash("sha256").update(text).digest("hex") };
export function providerFixture(options: {
  domain?: "zone" | "region";

  memory?: number;

  min?: number;

  slots?: number;

  registryOutage?: boolean;

  manualDrain?: boolean;

  provisionFailure?: boolean;

  unpriced?: boolean
} = {}) {
  const raw = JSON.parse(readFileSync(new URL("../../../docs/reality/m2i-ec2-source.json", import.meta.url), "utf8"));

  const reviews = JSON.parse(readFileSync(new URL("../../../docs/reality/m2i-source-reviews.json", import.meta.url), "utf8"));

  const snapshot = ec2Snapshot(raw, reviews), f = productFixture({
    horizon: 120000,

    max: 2,

    min: options.min ?? 1,

    slots: options.slots ?? 4,

    registryOutage: options.registryOutage
  });

  f.design.resources.find((r) => r.id === "vm")!.skuId = "m5.large";

  f.contract.catalogVersion = CATALOG_SNAPSHOT_DATE;

  for (const role of f.contract.nodes.vm!.resources) {
    const execution = role.config.kind === "compute" ? role.config : "execution" in role.config ? role.config.execution : undefined;

    if (!execution) throw Error("Fixture execution role missing");

    execution.cores = f.q.q(`provider.${role.role}.cores`, role.role === "main" ? 1 : 0.25, "cores");

    if (role.config.kind === "compute") {
      execution.memory.baseline = f.q.q(`provider.${role.role}.baseline`, 64, "bytes");

      execution.memory.perWorker = f.q.q(`provider.${role.role}.perWorker`, 8, "bytes");

      execution.memory.coverage = "complete-model";
    }
  }

  for (const demand of f.contract.application!.demands) if (demand.schema === "infraforge-compute-demand/1") {
    demand.requestResidentBytes = f.q.q(`provider.${demand.id}.resident`, 256, "bytes");

    demand.residentCoverage = "complete-model";
  }

  const provider: ProviderContract = {
    schema: "infraforge-provider-product/1",

    version: "authored-provider-proof/1",

    snapshot: snapshot.version,

    fingerprint: snapshotFingerprint(snapshot, providerHasher),

    asOf: snapshot.sources.map((s) => s.retrievedAt).sort().at(-1)!,

    reviewThrough: snapshot.sources[0]!.reviewThrough,

    hosts: [
      {
        node: "vm",
        scope: snapshot.prices[0]!.scope,

        fact: snapshot.instances[0]!.id,

        price: snapshot.prices[0]!.id,

        lifecycle: "provision-complete-to-termination/1",

        provenance: ["Authored software proof: post-provision artifact-start models billable allocation; process loss retains allocation; no measured EC2 lifecycle equivalence"],

        roles: f.contract.nodes.vm!.resources.map((r) => ({
          role: r.role,

          memory: f.q.q(`provider.${r.role}.memory`, r.role === "main" ? options.memory ?? 4096 : 1048576, "bytes"),

          mode: r.config.kind === "compute" ? "compute-admission" : "reservation"
        })),

        placements: Array.from({ length: options.slots ?? 4 }, (_, n) => ({ instance: `vm#${n}`, location: `aws:aws:use1-az${n % 2 + 1}` }))
      }
    ],

    relationships: [{ left: "vm#0", right: "vm#1", rule: "different-zone" }],

    faults: []
  };

  if (options.domain) provider.faults.push({
    id: "domain-incident",

    profile: "selected-process-loss/1",

    domain: options.domain === "zone" ? "aws:aws:use1-az1" : "aws:aws:us-east-1",

    nodes: ["vm"],

    at: f.q.q("provider.incident.at", 60000, "us"),

    duration: f.q.q("provider.incident.duration", 30000, "us"),

    restart: f.q.q("provider.incident.restart", 1000, "us"),

    provenance: ["Authored deterministic selected-process incident; not an AWS outage probability or complete physical zone failure"]
  });

  const controller = f.contract.nodes.vm!.controller!;

  if (options.manualDrain || options.provisionFailure) controller.initial = f.q.q("provider.initial.two", 2, "count");

  if (options.manualDrain) {
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
  }

  if (options.provisionFailure) controller.provisionFailures = [1];

  if (options.unpriced) provider.hosts[0]!.price = null;

  return { ...f, provider, snapshot, raw, reviews };
}
