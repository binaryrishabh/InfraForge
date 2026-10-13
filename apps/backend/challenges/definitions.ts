import { RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { fanIn, fanOut, starter } from "./starter";

/* Source-controlled challenge pack, calibrated against simulation model "1" and
catalog "2026-08". Any content change must bump `version`; the pinned spec
hashes in tests/challenges.test.ts make an unversioned edit fail loudly. */

const MODEL_NOTE = "InfraForge's simulator is an educational model with fixed rules, not a benchmark of real cloud services.";

export const CHALLENGES: readonly ChallengeDefinition[] = [
  {
    id: "first-production-api", version: 1, title: "First production API", difficulty: "starter",
    summary: "Put a small API online behind a load balancer and keep it healthy under steady traffic.",
    concepts: ["Load balancing", "Horizontal scaling", "Monthly cost"],
    story: [
      "A small team is launching its first public API. Traffic is modest and steady: about 400,000 requests an hour, mostly reads.",
      "They want it reachable through DNS, spread across more than one app server and backed by a database, without paying for capacity they do not need.",
    ],
    objective: "Run at least two app servers behind a load balancer, stay healthy at the evaluation second and keep the monthly estimate at $250 or less.",
    workload: { targetThroughput: 400_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.8, payloadSize: "medium" },
    workloadNote: "400,000 requests per hour, steady, 80% reads, medium payloads.",
    evaluationSeconds: 120, evaluationNote: "Checked at simulated second 120, after the 60-second ramp to full traffic.",
    criteria: [
      { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
      { id: "servers", kind: "min-app-servers", label: "At least 2 app servers behind a load balancer", count: 2 },
      { id: "health", kind: "overall-health", label: "Overall health is healthy at second 120", allowed: ["healthy"] },
      { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $250 or less", maxUsd: 250 },
    ],
    predictions: [
      { id: "health", kind: "overall-health", prompt: "What will overall health be at second 120?" },
      { id: "busiest", kind: "busiest-type", prompt: "Which resource type will have the highest CPU at second 120?" },
    ],
    hints: [
      "Traffic enters at DNS, which points at a load balancer. The load balancer spreads requests across the app servers connected to it.",
      "400,000 requests an hour is about 111 requests per second. In this model one generic app server sits near 75% CPU at that rate, which counts as degraded.",
      "Two generic app servers behind the load balancer share the traffic. Connect each of them to the database.",
    ],
    debrief: [
      "A generic app server in this model handles about 160 requests per second at full CPU, and writes add extra work. At 111 requests per second a single server sits in the degraded band (70% CPU or more). Two servers split the load and each stays near 37%.",
      "The database is often the busiest resource here. Every request becomes database work and each write counts twice, so it runs hotter than either app server even though it is never the focus of the brief.",
      MODEL_NOTE,
    ],
    starter: null,
  },
  {
    id: "secure-the-edge", version: 1, title: "Secure the edge", difficulty: "starter",
    summary: "An inherited design works, but exposes more than it should. Close the gaps without breaking it.",
    concepts: ["Network exposure", "Encryption", "SSH access"],
    story: [
      "You have inherited a working design from a hurried launch. It serves traffic, but the security scan will not be happy.",
      "Some resources are public that should not be, one app server allows SSH from anywhere, and public endpoints are not encrypted.",
    ],
    objective: "Get a clean security scan while keeping every resource out of saturation at the evaluation second.",
    workload: { targetThroughput: 400_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.8, payloadSize: "medium" },
    workloadNote: "400,000 requests per hour, steady, 80% reads, medium payloads.",
    evaluationSeconds: 90, evaluationNote: "Checked at simulated second 90.",
    criteria: [
      { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
      { id: "security", kind: "security-clean", label: "Security scan reports no issues" },
      { id: "capacity", kind: "no-saturation", label: "No resource saturated or failed at second 90" },
    ],
    predictions: [
      { id: "security", kind: "security-clean", prompt: "Will the security scan report zero issues for the design you submit?" },
      { id: "health", kind: "overall-health", prompt: "What will overall health be at second 90?" },
    ],
    hints: [
      "Select each resource and open its exposure settings in the inspector. The scan looks at public access, encryption and open ports.",
      "Only the entry point needs to be public. The scan flags any public resource without encryption, any public resource with port 22 open, and any public database.",
      "Keep the load balancer public but encrypted. Make the app servers and the database private.",
    ],
    debrief: [
      "The scan applies three rules to each resource: a database must not be public, a public resource must not expose port 22, and a public resource must be encrypted. The starter broke all three, five times in total.",
      "Exposure settings do not change capacity in this model. Making resources private removes findings without changing CPU or health, so the original two app servers still carry the load.",
      MODEL_NOTE,
    ],
    starter: starter([
      ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1, { public: true }],
      ["vm1", T.VirtualMachine, 2, 0, { public: true, openPorts: [22, 8080] }], ["vm2", T.VirtualMachine, 2, 2],
      ["db", T.Database, 3, 1, { public: true }],
    ], [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2"]), ...fanIn(["vm1", "vm2"], "db")]),
  },
  {
    id: "cache-matters", version: 1, title: "Cache matters", difficulty: "core",
    summary: "A read-heavy API overwhelms its database. Relieve it without buying the biggest instance.",
    concepts: ["Caching", "Read/write mix", "Database load"],
    story: [
      "A catalogue API serves 1.8 million requests an hour, and 95% of them are reads of the same popular items.",
      "The current design sends every request straight to one database. Adding app servers alone has not fixed it.",
    ],
    objective: "Keep the database healthy and every resource out of saturation at the evaluation second, for $400 a month or less.",
    workload: { targetThroughput: 1_800_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.95, payloadSize: "medium" },
    workloadNote: "1,800,000 requests per hour, steady, 95% reads, medium payloads.",
    evaluationSeconds: 150, evaluationNote: "Checked at simulated second 150, after the ramp and the autoscaler's first reactions.",
    criteria: [
      { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
      { id: "database", kind: "database-healthy", label: "Every database is healthy at second 150" },
      { id: "capacity", kind: "no-saturation", label: "No resource saturated or failed at second 150" },
      { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $400 or less", maxUsd: 400 },
    ],
    predictions: [
      { id: "database", kind: "database-health", prompt: "What will the database's health be at second 150?" },
      { id: "busiest", kind: "busiest-type", prompt: "Which resource type will have the highest CPU at second 150?" },
    ],
    hints: [
      "Run the starter once, or reason about it: which resource is at 100% CPU? More app servers do not reduce the number of database queries.",
      "A cache placed between the app servers and the database absorbs most repeated reads in this model.",
      "Connect the app servers to a cache and the cache to the database. Four or five generic app servers are enough for the traffic itself.",
    ],
    debrief: [
      "Without a cache, the database receives one query per read and two per write: about 525 queries per second here, more than double what a generic database handles. Adding app servers spreads CPU but leaves that total unchanged.",
      "When a cache sits upstream, this model serves 80% of reads from it, so the database's query load drops to under a third. A larger database instance would also work, but it costs more than this budget allows.",
      MODEL_NOTE,
    ],
    starter: starter([
      ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
      ["vm1", T.VirtualMachine, 2, 0], ["vm2", T.VirtualMachine, 2, 1], ["vm3", T.VirtualMachine, 2, 2],
      ["db", T.Database, 3, 1],
    ], [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2", "vm3"]), ...fanIn(["vm1", "vm2", "vm3"], "db")]),
  },
  {
    id: "write-heavy", version: 1, title: "Write-heavy workload", difficulty: "core",
    summary: "Most traffic writes data. Find out what a cache can and cannot do for you.",
    concepts: ["Write load", "Database sizing", "Instance catalog"],
    story: [
      "An event-ingest API receives 900,000 small requests an hour. Seven in ten are writes.",
      "The team added a cache last quarter and the database is still at its limit. They now want to size the design on real catalog instances.",
    ],
    objective: "Use catalog instance sizes for compute and databases, keep the database healthy and avoid saturation, for $750 a month or less.",
    workload: { targetThroughput: 900_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.3, payloadSize: "light" },
    workloadNote: "900,000 requests per hour, steady, 30% reads, light payloads.",
    evaluationSeconds: 180, evaluationNote: "Checked at simulated second 180.",
    criteria: [
      { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
      { id: "sizes", kind: "catalog-sizes", label: "Every app server and database uses a catalog instance size" },
      { id: "database", kind: "database-healthy", label: "Every database is healthy at second 180" },
      { id: "capacity", kind: "no-saturation", label: "No resource saturated or failed at second 180" },
      { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $750 or less", maxUsd: 750 },
    ],
    predictions: [
      { id: "database", kind: "database-health", prompt: "What will the database's health be at second 180?" },
      { id: "busiest", kind: "busiest-type", prompt: "Which resource type will have the highest CPU at second 180?" },
    ],
    hints: [
      "Pick instance sizes in the inspector. A generic resource has no catalog size.",
      "A cache only absorbs reads. With 70% writes, the database's work barely changes with or without it.",
      "Writes count twice for the database in this model. Size the database for that load first, then fit app servers to the remaining budget.",
    ],
    debrief: [
      "About 250 requests per second arrive, and each write costs the database two queries, so it handles about 425 queries per second without a cache. A cache can only remove part of the 30% that are reads, which still leaves about 365.",
      "Keeping that under 70% CPU needs a database tier with roughly 600 or more queries per second of capacity, which in this catalog means a 6- or 8-vCPU tier. The budget then leaves room for modest app servers, not oversized ones.",
      MODEL_NOTE,
    ],
    starter: starter([
      ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
      ["vm1", T.VirtualMachine, 2, 0], ["vm2", T.VirtualMachine, 2, 2],
      ["cache", T.Cache, 3, 1], ["db", T.Database, 4, 1],
    ], [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2"]), ...fanIn(["vm1", "vm2"], "cache"), ["cache", "db"]]),
  },
  {
    id: "scale-out-safely", version: 1, title: "Scale out safely", difficulty: "advanced",
    summary: "More app servers should help, until each one opens its own database connections.",
    concepts: ["Autoscaling", "Connection limits", "Instance catalog"],
    story: [
      "A read-heavy service at 2.4 million requests an hour already uses a cache. The autoscaler keeps adding app servers, but the database still falls over.",
      "Every app server holds its own pool of database connections. Nobody has checked how many the database accepts.",
    ],
    objective: "Use catalog sizes, stay within the database's connection limit and avoid saturation at the evaluation second, for $650 a month or less.",
    workload: { targetThroughput: 2_400_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.95, payloadSize: "light" },
    workloadNote: "2,400,000 requests per hour, steady, 95% reads, light payloads.",
    evaluationSeconds: 240, evaluationNote: "Checked at simulated second 240, after the autoscaler has had time to add replicas.",
    criteria: [
      { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
      { id: "sizes", kind: "catalog-sizes", label: "Every app server and database uses a catalog instance size" },
      { id: "connections", kind: "database-connections", label: "Database connections stay within the instance limit at second 240" },
      { id: "capacity", kind: "no-saturation", label: "No resource saturated or failed at second 240" },
      { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $650 or less", maxUsd: 650 },
    ],
    predictions: [
      { id: "scale", kind: "scale-out", prompt: "At second 240, will the autoscaler be running more app servers than you placed?" },
      { id: "database", kind: "database-health", prompt: "What will the database's health be at second 240?" },
    ],
    hints: [
      "Look at the database's connection count, not only its CPU. Each app server, including autoscaled replicas, opens 20 connections in this model.",
      "A generic database accepts 100 connections. When connections exceed the limit, the model forces the database to at least 95% CPU.",
      "Choose a catalog database whose connection limit covers every app server you expect, and place enough app servers that the autoscaler has nothing left to add.",
    ],
    debrief: [
      "Connections in this model are 20 per app server. The starter's three servers plus the replicas the autoscaler added exceed a generic database's 100-connection limit, and the model then treats the database as saturated regardless of its query load.",
      "Most catalog database tiers accept several hundred connections. With enough fixed app servers, CPU stays below the autoscaler's target, no replicas are added and the connection count stays predictable.",
      MODEL_NOTE,
    ],
    starter: starter([
      ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
      ["vm1", T.VirtualMachine, 2, 0], ["vm2", T.VirtualMachine, 2, 1], ["vm3", T.VirtualMachine, 2, 2],
      ["cache", T.Cache, 3, 1], ["db", T.Database, 4, 1],
    ], [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2", "vm3"]), ...fanIn(["vm1", "vm2", "vm3"], "cache"), ["cache", "db"]]),
  },
  {
    id: "peak-traffic", version: 1, title: "Survive the peak", difficulty: "advanced",
    summary: "Traffic doubles in short bursts. The evaluation lands inside one of them.",
    concepts: ["Traffic bursts", "Autoscaling lag", "Headroom"],
    story: [
      "A ticketing API averages 1.5 million requests an hour, but every two minutes a 20-second burst doubles the load.",
      "The current design looks fine between bursts. The evaluation second falls in the middle of a burst.",
    ],
    objective: "Use catalog sizes and keep every resource out of saturation during the burst at the evaluation second, for $750 a month or less.",
    workload: { targetThroughput: 1_500_000, throughputUnit: "per-hour", trafficShape: "peak", peakMultiplier: 2, readWriteRatio: 0.85, payloadSize: "medium" },
    workloadNote: "1,500,000 requests per hour with 2× bursts every 120 seconds, 85% reads, medium payloads.",
    evaluationSeconds: 250, evaluationNote: "Checked at simulated second 250, inside the burst that starts at second 240.",
    criteria: [
      { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
      { id: "sizes", kind: "catalog-sizes", label: "Every app server and database uses a catalog instance size" },
      { id: "capacity", kind: "no-saturation", label: "No resource saturated or failed at second 250" },
      { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $750 or less", maxUsd: 750 },
    ],
    predictions: [
      { id: "health", kind: "overall-health", prompt: "What will overall health be at second 250?" },
      { id: "scale", kind: "scale-out", prompt: "At second 250, will the autoscaler be running more app servers than you placed?" },
      { id: "busiest", kind: "busiest-type", prompt: "Which resource type will have the highest CPU at second 250?" },
    ],
    hints: [
      "Watch the run around second 240. Bursts ramp up over 5 seconds and last 20.",
      "The autoscaler reacts only after 5 hot seconds and needs 60 more to bring a replica online, so it cannot catch a 20-second burst.",
      "Provision headroom up front: more or larger app servers so the burst fits, while keeping the database and the budget in check.",
    ],
    debrief: [
      "Bursts double the request rate for 20 seconds. A replica the autoscaler starts during a burst comes online about 65 seconds later, after the burst has ended, so only capacity that already exists counts.",
      "Degraded is acceptable here: the requirement is to stay out of saturation. Six c5.large servers or three c5.xlarge servers both absorb the burst within budget; three c5.large servers do not.",
      MODEL_NOTE,
    ],
    starter: starter([
      ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
      ["vm1", T.VirtualMachine, 2, 0, { skuId: "c5.large" }], ["vm2", T.VirtualMachine, 2, 1, { skuId: "c5.large" }],
      ["vm3", T.VirtualMachine, 2, 2, { skuId: "c5.large" }],
      ["cache", T.Cache, 3, 1], ["db", T.Database, 4, 1, { skuId: "db.m5.xlarge" }],
    ], [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2", "vm3"]), ...fanIn(["vm1", "vm2", "vm3"], "cache"), ["cache", "db"]]),
  },
];
