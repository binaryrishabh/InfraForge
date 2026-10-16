import type { ComputeResource } from "../../model2/compute/contracts";
import type { ResourceTemplate } from "../../model2/product/contracts";
import { compileProduct } from "../../model2/product/compiler";
import { canonical } from "../../model2/product/provenance";
import { boundedProduct } from "../../model2/product/bounds";
import { requireKnown } from "../quantity";
import type { ProductInputs, ProviderContract, ProviderProduct, ProviderSnapshot, Placement } from "./contracts";
import { validateSnapshot } from "./facts";
import { checkRelationships, locationIndex } from "./locations";
import { bounded, timestamp } from "./validity";
import { add, compare, decimal, fraction } from "./exact";
import { sameScope } from "./pricing";
import { digest, normalizedSnapshot, snapshotFingerprint } from "./fingerprint";
import type { ContentHasher } from "./fingerprint";

function execution(r: ResourceTemplate): Omit<ComputeResource, "id"> | ComputeResource | undefined {
  return r.kind === "compute" ? r : "execution" in r ? r.execution : undefined;
}
export function compileProviderProduct(inputs: ProductInputs, authored: ProviderContract, snapshot: ProviderSnapshot, hasher: ContentHasher): ProviderProduct {
  bounded(authored);

  validateSnapshot(snapshot, authored.asOf);

  boundedProduct(inputs.design);

  boundedProduct(inputs.contract);

  const { design, contract } = canonical(inputs), provider = canonical(authored), facts = normalizedSnapshot(snapshot);

  if (provider.schema !== "infraforge-provider-product/1" || !provider.version || provider.snapshot !== facts.version || timestamp(provider.asOf) > timestamp(provider.reviewThrough) || !provider.hosts.length || provider.hosts.length > 128 || provider.faults.length > 128 || provider.relationships.length > 2048) throw Error("Provider contract version/validity/budget");

  if (provider.fingerprint !== snapshotFingerprint(facts, hasher)) throw Error("Provider fact content drift under the pinned version");

  provider.hosts.sort((a, b) => a.node < b.node ? -1 : 1);

  provider.faults.sort((a, b) => a.id < b.id ? -1 : 1);

  provider.relationships.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);

  const designNodes = new Map(design.resources.map((r) => [r.id, r])), instanceFacts = new Map(facts.instances.map((f) => [f.id, f]));

  const prices = new Map(facts.prices.map((p) => [p.id, p])), sources = new Map(facts.sources.map((s) => [s.id, s]));
  const factLedgers = new Set<string>();
  let roleCount = 0;
  for (const node of design.resources) {
    const profile = contract.nodes[node.id];
    if (!profile) continue;
    const slots = profile.controller ? requireKnown(profile.controller.slots, "count") : 1;
    if (!Number.isSafeInteger(slots) || slots < 1 || slots > 128) throw Error("Provider pool slot budget");
    roleCount += slots * profile.resources.length;
    if (roleCount > 256) throw Error("Provider materialized resource budget");
  }

  const locations = locationIndex(facts.locations), nodes = new Set<string>(), placements: Placement[] = [], hosts: ProviderProduct["hosts"] = [];

  for (const host of provider.hosts) {
    const node = designNodes.get(host.node), profile = contract.nodes[host.node], fact = instanceFacts.get(host.fact);

    if (!node || node.type !== "Virtual Machine" || !profile || !fact || nodes.has(node.id) || !host.provenance.length || host.lifecycle !== "provision-complete-to-termination/1") throw Error("Explicit unique VM/provider fact/lifecycle binding required");

    nodes.add(node.id);

    host.roles.sort((a, b) => a.role < b.role ? -1 : 1);

    host.placements.sort((a, b) => a.instance < b.instance ? -1 : 1);

    if (node.skuId !== fact.sku) throw Error("Saved SKU and provider binding disagree");

    const region = locations.byId.get(fact.region)!;

    const slots = profile.controller ? requireKnown(profile.controller.slots, "count") : 0;

    if (!Number.isSafeInteger(slots) || slots < 1 || slots > 128) throw Error("Provider pool slot budget");

    const ids = Array.from({ length: slots }, (_, n) => `${node.id}#${n}`);

    if (!ids.length) throw Error("M2I lifecycle metering requires a controller-owned VM pool");

    if (host.placements.length !== ids.length || new Set(host.placements.map((p) => p.instance)).size !== ids.length || host.placements.some((p) => !ids.includes(p.instance) || !locations.contains(region.id, p.location))) throw Error("Exact per-slot placement in the instance fact region required");

    placements.push(...host.placements);

    const roles = profile.resources.filter((r) => execution(r.config));

    if (host.roles.length !== roles.length || new Set(host.roles.map((r) => r.role)).size !== roles.length || host.roles.some((r) => !roles.some((p) => p.role === r.role))) throw Error("Every owned CPU/memory role needs one explicit host partition");

    let cores = fraction(0n), memory = 0n;

    for (const role of roles) {
      const cpu = execution(role.config)!, partition = host.roles.find((r) => r.role === role.role)!;

      const bytes = requireKnown(partition.memory, "bytes");

      if (!Number.isSafeInteger(bytes) || bytes < 1) throw Error("Positive exact authored memory partition required");

      const assigned = requireKnown(cpu.cores, "cores");

      if (!Number.isFinite(assigned) || assigned <= 0) throw Error("Positive authored CPU allocation required");

      cores = add(cores, decimal(String(assigned)));

      memory += BigInt(bytes);

      if (role.config.kind === "compute") {
        if (partition.mode !== "compute-admission" || cpu.memory.coverage !== "complete-model") throw Error("Compute admission needs explicitly complete authored modeled memory; partial physical memory cannot become complete");

        if (cpu.memory.limit && requireKnown(cpu.memory.limit, "bytes") !== bytes) throw Error("Authored memory limit conflicts with host partition");

        cpu.memory = { ...cpu.memory, limit: partition.memory, policy: "reject-allocation" };
      } else if (partition.mode !== "reservation") throw Error("Auxiliary role only supports authored reservation; memory admission mechanism unavailable");

      if (role.config.kind === "artifact-client" && bytes < requireKnown(role.config.cacheBytes, "bytes")) throw Error("Artifact cache bytes exceed authored reservation");
    }

    if (compare(cores, fraction(String(fact.vCpu))) > 0 || memory > BigInt(fact.memoryBytes)) throw Error("Host CPU/memory partitions exceed sourced capability; no automatic throughput or oversubscription");

    const factId = `m2i.${fact.id}.vCpu`;

    if (!factLedgers.has(factId)) {
      if (contract.ledger.some((r) => r.id === factId)) throw Error("Reserved provider ledger identity collision");
      factLedgers.add(factId);
      contract.ledger.push({
      id: factId,

      concept: "vCpu",

      modelVersion: "2",

      classification: "provider-fact",

      quantity: { kind: "known", unit: "count", value: fact.vCpu, provenance: [factId] },

      scope: `${fact.sku}; ${fact.region}; ${facts.version}`,

      validityDomain: `${provider.asOf}; exact selected provider snapshot`,

      formula: "Exact public product vCPU descriptor; upper bound on authored role partitions only",

      confidence: "conditional",

      provenance: [{
        source: sources.get(fact.source)!.url,

        supports: "exact",

        detail: `${fact.sku} vCPU field in retained regional price product`
      }],

      assumptions: ["No effective CPU, throughput, hardware scheduling or live capacity claim"],

      researchedOn: provider.asOf.slice(0, 10),

      freeMode: "forbidden",

      replacement: "Independent application demand and physical calibration required"
      });
    }

    if (contract.capabilities.some((c) => c.resource === node.id)) throw Error("Duplicate legacy/provider capability binding");

    contract.capabilities.push({
      resource: node.id,

      sku: fact.sku,

      catalogVersion: contract.catalogVersion,

      field: "vCpu",

      value: { kind: "known", unit: "count", value: fact.vCpu, provenance: [factId] },

      fact: factId
    });

    if (!sameScope(host.scope, host.scope) || host.scope.provider !== fact.provider || host.scope.service !== fact.service || host.scope.product !== fact.sku || host.scope.region !== fact.region) throw Error("Explicit usage scope must match the selected capability independently of its price");
    const price = host.price === null ? null : prices.get(host.price);

    if (price === undefined || price && (!sameScope(price.scope, host.scope) || price.provenance !== "provider-fact")) throw Error("Unknown or incompatible provider price binding");

    hosts.push({ node: node.id, scope: host.scope, instances: ids, fact, price });
  }

  checkRelationships(facts.locations, placements, provider.relationships);

  const domainEffects: ProviderProduct["domainEffects"] = [];

  const faults = new Set<string>();

  for (const f of provider.faults) {
    if (!f.id || f.profile !== "selected-process-loss/1" || faults.has(f.id) || !f.nodes.length || new Set(f.nodes).size !== f.nodes.length || !f.provenance.length || !locations.byId.has(f.domain)) throw Error("Explicit domain incident identity/membership/evidence required");

    f.nodes.sort();

    faults.add(f.id);

    const targets: string[] = [];

    for (const id of f.nodes) {
      const host = hosts.find((h) => h.node === id);

      if (!host) throw Error("Domain process fault only supports explicitly bound VM hosts; managed-service fate is Unknown");

      for (const p of placements.filter((p) => host.instances.includes(p.instance) && locations.contains(f.domain, p.location))) {
        targets.push(p.instance);

        contract.faults.push({
          id: `domain:${f.id}:${p.instance}`,

          kind: "Crash",

          target: p.instance,

          at: f.at,

          duration: f.duration,

          restart: f.restart,

          profile: "retain-logical-state/1"
        });
      }
    }

    if (!targets.length) throw Error("Domain incident has no bound process targets");

    domainEffects.push({ fault: f.id, domain: f.domain, targets: targets.sort() });
  }

  const compiled = compileProduct(design, contract);

  if (!compiled.ok) throw Error(compiled.diagnostics.map((d) => `${d.code}: ${d.path}: ${d.message}`).join("; "));

  const payload: Omit<ProviderProduct, "fingerprint"> = {
    schema: "infraforge-provider-compiled/1",

    product: compiled.value,

    facts,

    provider,

    placements,

    hosts,

    domainEffects,

    unknown: [
      "Physical CPU/SMT/runtime equivalence and application throughput",

      "Zone offering, account quota and live allocation capacity",

      "Latency, bandwidth, geographical distance and probabilistic reliability",

      "Managed service fault propagation and physical durability",

      "Auxiliary resident memory beyond authored reservations; complete host memory",

      "Unselected services/meters, tax, discounts, credits, data transfer and full provider bill",

      "Exact storage occupancy integral without mutation-boundary evidence"
    ]
  };

  return canonical({ ...payload, fingerprint: digest(payload, hasher) });
}
