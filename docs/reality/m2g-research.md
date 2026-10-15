# M2G research and contract decisions

Primary documentation reviewed 2026-10-15. All profiles below are authored internal
mechanisms, not provider emulators. Model 1 remains active; Model 2 is internal.

## Resolution is separate from application routing

DNS records carry names, types, values and TTLs. A resolver can reuse an answer only
within its cache lifetime. NXDOMAIN is different from a timeout or unavailable
authority; standard DNS negative caching uses SOA-derived lifetime rules.
[RFC 1035](https://www.rfc-editor.org/rfc/rfc1035.html),
[RFC 2308](https://www.rfc-editor.org/rfc/rfc2308).

M2G implements an explicit authoritative A-record owner and a forwarding resolver,
not full recursive delegation. Names are canonicalized; ordered A answers map to
authored IPv4 endpoint identities. First-address selection is deterministic, not
weighted/failover routing. Cache entries own virtual-time expiry timers and LRU
entry limits. The authority supplies an explicit negative TTL; only NXDOMAIN is
cached negatively. This generic negative contract is not wire-level RFC 2308/SOA
emulation. Timeouts/unavailability are not cached as nonexistence. Positive expiry
is based on the authority's answer time, so transit does not extend its lifetime.

Only creation of a new hostname-dependent physical connection resolves DNS.
An existing pooled session retains its selected destination after answer expiry,
record changes or resolver/authority failure. New connections may use a still-valid
cached answer, then fail after expiry. A DNS answer selects a real destination and
authored link route before application bytes can be delivered. Bootstrap resolver
and authority addresses must be explicit to prevent circular resolution.
DNS traffic uses the existing connection/message transport with authored envelopes;
it is not a UDP packet/DNS serializer. CNAME/AAAA, recursive delegation, DNSSEC,
serve-stale, racing/failover answers and propagation across independent authorities
remain separate future contracts.

## CDN owns reusable response objects

HTTP caching needs explicit request eligibility, cache keys, freshness and invalidation.
Request collapsing can share a suitable origin response, while unsuitable responses
still require independent forwarding. Full HTTP policy includes much more than a TTL.
[RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html).

M2G selects a narrow GET/current-object CDN. Namespace/key identifies cached complete
content/generation/bytes, with an authored TTL and logical byte capacity. It shares
expiry and LRU eviction ownership primitives with M2E; payload, origin, fills and
service remain CDN-specific. Misses perform actual M2F object GET through the
network/pool. Each hit or filled response transfers its actual body bytes. Optional
coalescing shares one in-flight origin request per key with bounded waiters. Purge
changes actual entries and generation/epoch tokens; an older fill cannot repopulate
purged state. Failed requests may remain pending after origin return until their
own timeout; recovery is not automatic retry. No stale serving, Vary, authorization
cache policy, revalidation, ranges, multipart, geographic edge routing or complete
HTTP compliance is inferred. Logical capacity excludes unknown allocator overhead.

## Listeners, ordered policy and established flow state

Stateful security groups can permit established return traffic; network ACLs instead
have ordered allow/deny rules and different return-traffic requirements. These are
different product contracts, not interchangeable firewall labels.
[Security-group statefulness](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html),
[network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html).

M2G's `ordered-stateful/1` is an authored generic TCP admission profile, not an AWS
security group or ACL. Source/destination identities have explicit internal/external
zones and IPv4 addresses. Each attached firewall evaluates egress and ingress using
priority/id order, first matching rule, explicit defaults, identity/zone/CIDR scopes
and port ranges. A permitted port and a listener are separate. Denied/no-listener
connections cannot deliver application work. Admitted physical connections own
bounded policy flow entries; close/reset/idle expiry releases them. Responses use
the admitted flow rather than being treated as unrelated ingress. Rule replacement
affects new flows and preserves existing ones. Kernel conntrack, packets, NAT,
protocols beyond TCP, destructive flow-table loss and cloud-product behavior are
not claimed. Rule scanning cost is executor work, not calibrated firewall CPU.

Public exposure is derived only from configured external paths, route availability,
current listener/policy/TLS compatibility and endpoint readiness. No external path
means no modeled internet reachability. Hostname assessments without a current
observed answer are Unknown. The internal assessment reports actual permitted DB/
SSH/plaintext paths, denied paths, no listener and TLS mismatches. Legacy diagram
booleans and the historical Model-1 scan are not silently translated or rewritten.

## TLS authentication has a real admission consequence

TLS defines authenticated handshakes and protected application traffic. Service
identity verification is separate from simply encrypting bytes; a certificate must
identify the intended service under the client's trust policy.
[TLS 1.3](https://www.rfc-editor.org/rfc/rfc8446.html),
[service identity](https://www.rfc-editor.org/rfc/rfc9525.html).

M2G distinguishes plaintext and authenticated clients, plaintext/optional/required
listeners, exact asserted DNS names, trusted issuer labels and virtual validity
windows. Incompatibility prevents application delivery. Existing sessions retain
their establishment decision; expiry/policy changes gate new sessions, not an
invented renegotiation. This proves compatibility of authored assertions, not
cryptographic security, a real certificate chain, revocation or PKI validation.
Handshake crypto CPU, framing and physical timing remain Unknown. Authored generic
connection setup is separate; no universal TLS delay is fitted. The local campaign
uses real Node/OpenSSL TLS to verify actual authentication failures independently.

## Registry artifacts are graphs, not image-size delays

Distribution separates content-addressed blobs, manifests and mutable references.
Clients retrieve manifests then required layers; digest checks establish content
identity, and partial upload/pull recovery requires further owned state.
[Distribution API](https://distribution.github.io/distribution/spec/api/),
[OCI distribution](https://github.com/opencontainers/distribution-spec/blob/main/spec.md),
[OCI manifests](https://github.com/opencontainers/image-spec/blob/main/manifest.md).

M2G's registry owns immutable SHA-256-labelled blob descriptors, immutable manifest
graphs and mutable tags. Blob storage composes actual M2F conditional PUT/HEAD/GET
and byte transport. Conflicting sizes/content labels are refused. Manifests require
existing matching blobs. Shared layers are stored once, and per-node caches retain
actual acquired layer identities/bytes. Startup resolves a manifest and downloads
only missing layers before setting that compute target ready. Outage affects pulls,
not already-running replicas; failed startups need authored bounded retries.
Simulation digests are trusted workload declarations, not hashes computed over
giant simulated buffers. Hash verification/CPU, manifests' physical persistence,
OCI wire compliance, authorization, signatures, indexes, uploads in parts, range
resume, decompression, image execution and GC remain partial/Unknown/deferred.

## Observation can be missing while the resource still fails

Collector queues, retries and finite capacity reduce some loss but do not eliminate
it. Memory-only telemetry can be lost, exhausted queues can drop samples, and a
successful export does not imply an always-available underlying system.
[OpenTelemetry resiliency](https://opentelemetry.io/docs/collector/resiliency/).

M2G collects explicit instrumented station fields over authored network paths.
Only an arriving request captures a target snapshot. Agent CPU/service is authored;
target instrumentation CPU is Unknown. Fixed-schema logical sample bytes enter
network export. Measurement time, collection time and backend arrival time differ.
Buffers include queued and in-flight samples, with count/byte bounds, drop-newest
admission, bounded export attempts and explicit losses. Batch IDs/sample IDs permit
backend dedup after ambiguous retries. Backend retention is independently bounded.
Agent failure does not set application health; it stops/delays observations. Freshness
uses actual measurement time. Recovery collects new samples without reconstructing
missing periods. Cumulative counters after return do not locate historical events.
Logs/traces, arbitrary labels/cardinality, sampling estimators, durable WAL and a
full observability backend remain outside this metric-only profile.

## Numerical applicability and shipping

Semantic verification and executor benchmarks do not calibrate service timing.
M2D/M2E/M2F rejected predictors stay rejected; M2F object timing stays Unknown.
Any M2G local observations apply only to their exact host/software/configuration.
No cloud resource/account/configuration is accessed. Model-2 shipping remains
blocked by the inventory until visible technical controls have real mechanisms,
downstream effects and evidence, or are removed. UI navigation metadata is distinct
from infrastructure physics; marking a source-reviewed UI action REAL grants no
provider or performance claim.
