# M2G internal systems architecture

Explicit `m2g/1` selection composes M2F queue/object ownership, M2E data resources,
M2D byte paths and connection pools, M2C CPU and M2B caller identity. Model 1 stays
published; the internal default remains M2D. No diagram migration, UI activation,
provider mapping, schema change or production deployment is performed.

`systems/contracts.ts` separates authoritative/resolver DNS, CDN, registry, artifact
clients, metric agents/backends, listener and firewall contracts. `service.ts` owns
bounded command admission, actual authored CPU/wait, child operations, timeout and
cancellation. Resource modules own distinct state. `validate.ts` checks provenance,
units, budgets and explicit paths before copying input. Unsupported demand stays
Unknown/fails closed; execution is never silently assigned a universal latency.

## Connection establishment and security

New M2D hooks run only when a physical pooled connection is created. The timeout
already owns establishment, including resolution. A hostname-dependent connection
queries the explicit resolver over its own authored path. A successful A answer
selects an authored destination/link route; subsequent application bytes use that
route and resource identity. Existing leases reuse their original route without
DNS lookup. Connection close releases the correct actual destination's DB session
and firewall state, including when DNS selected a different target.

Every M2G path declares TCP, listener port, attached policy and client security.
All policy directions must permit the new flow. A listener must exist separately,
the endpoint must be ready/alive and the route available. Authenticated clients
check a compatible listener, asserted exact certificate name, issuer label and
virtual validity window. No application request is delivered after failure. The
TLS gate has real state/admission effects; crypto, handshake framing and physical
service demand are Unknown. It is not a TLS implementation or PKI validation.

Each admitted connection owns stateful firewall entries. Policy replacement affects
new admissions while established requests/returns continue under their admitted
state. Pool close/reset/idle expiry removes entries. This generic ordered stateful
profile is not an AWS security group, ACL or kernel conntrack emulator. The pure
assessment derives configured external DB/SSH/plaintext exposure, blocked paths,
no listener and TLS mismatches. No external path means blocked. Hostname paths
without a current observed answer report Unknown. Legacy `public`, `encryption`
and `openPorts` fields remain explicitly unbridged/unshippable.

## DNS and CDN ownership

Authoritative A records retain name, addresses, owner, generation and TTL. Positive
and explicit NXDOMAIN cache entries have expiry timers, bounded LRU ownership and
copied answers. Resolver/authority outages differ. Record changes do not mutate
previous cache snapshots or established connections. Negative TTL is authored;
SOA/delegation, CNAME/AAAA, DNSSEC and wire serialization are deferred.

CDN stores complete namespace/key/content/generation/byte entries. Expiry and LRU
ownership primitives are shared with M2E. GET misses issue real object-store GETs
over M2D. Optional coalescing owns one fill and bounded waiting commands; disabling
it permits independent origin work. Capacity counts actual logical object bytes.
Purge increments key/epoch state so older fills cannot repopulate it. Existing fill
waiters may receive their selected object, but it is not cached after invalidation.
No stale serving, full HTTP policy, geographic edge or fixed hit ratio is inferred.

## Artifacts and readiness

Registry blob upload composes conditional M2F PUT and HEAD identity verification.
Blob reads compose actual GET and transfer selected body bytes. Manifests reference
existing matching immutable descriptors; tags are mutable references. Unique digest
storage is separate from repeated references and node download caches. Simulation
digests are declared workload identities, not hashes computed over giant buffers.
The independent local reference verifies real bounded buffers with SHA-256.

Artifact clients resolve a manifest and fetch only missing layers. Each replica
retains the resolved digest and required layer identities, so a later tag mutation
does not rewrite an already-running image. Readiness is set only after acquisition;
an active compute fault still gates readiness, and its ending preserves completed
artifact state. Failed startup has finite authored retries/backoff. Node cache
capacity is checked again at response commit under concurrent acquisition. Partial
completed layers survive; partial network payloads, unpacking, execution, auth,
OCI resumable uploads/ranges/indexes and GC are not modeled.

## Observation pipeline

Only explicit instrumented targets answer observation requests, after real network
arrival and readiness/access checks. Samples contain actual station counters and
endpoint state at measurement time. Agent command CPU/wait and transport consume
authored resources. Target instrumentation CPU is Unknown, not a calibrated zero.
Collection time and backend arrival are separate timestamps. Neither an old healthy
sample nor collector failure determines current application health.

Agent capacity includes queued and in-flight samples/bytes. Drop-newest rejects
new observations at capacity. Export moves owned samples into a batch; success
releases ownership, failure retries within a bound. Stable sample identities let
the backend deduplicate ambiguous retries and reject conflicting identity reuse.
Backend latest ages use measurement time and do not regress for late old samples.
Backend retention is finite; a full backend refuses new samples.

`dropped` means agent ownership discarded. `droppedBeforeExport` establishes local
loss before any send; `discardedUnconfirmed` may already exist at the backend after
a lost acknowledgement. Backend samples and duplicate counts remain independent.
This prevents a false claim that an export timeout proves telemetry never arrived.
Agent freshness describes collected knowledge; backend ages describe what arrived.
No missing sample is reconstructed, interpolated or labelled observed.

## Shipping and bounds

`shipping-reality.json` inventories 441 current schema/resource/chaos/interactive/
technical display surfaces. Source descriptions and control fingerprints retain
identity. Coverage tests fail on new/changed controls without entries; the writer
defaults new entries to UNKNOWN/ineligible. Regular Model-1 checks validate coverage
without requiring an unfinished Model-2 migration to ship. `check:model2-shipping`
is a separate intentionally failing gate until every required surface is eligible.
Current counts are 62 REAL product metadata/UI actions, 26 PARTIAL, 349 MODEL1_ONLY
and four REMOVE_BEFORE_MODEL2_SHIP. The 379 blocked entries are enumerated durably.
REAL UI metadata grants no infrastructure/provider/timing claim.

Important executor policies: 100,000 state entries/flows, 10,000 rules per policy,
512 resource/target/concurrency limits, 1,000 lineage rows and attempts, 1,000,000
authored command fields and bounded depth/text. Earlier M2B–M2F structural/time/
event limits also apply. These are implementation policy, not provider capacities.
Counts and bytes reconcile against owned state. Evidence copies do not run service,
expire state or commit operations. Budget exhaustion is explicit incomplete work.
