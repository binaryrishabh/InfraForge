# M2G local observations and numerical boundary

The source-hashed `systems-benchmark.mjs` runs only uniquely owned loopback native
DNS/TLS and independent Node HTTP references. It does not modify system DNS, trust
stores, developer services or hosted configuration. Temporary TLS keys/certificates
are created in a unique owned directory, never retained in artifacts, and exact
files are removed after all sockets/servers close. `campaignComplete` and cleanup
are separate checks. The first sandbox attempt could not complete native DNS;
the authorized loopback run outside that network sandbox completed successfully.

Raw observations in `m2g-measurements.json` retain host/Node/OpenSSL versions,
source/environment hashes, explicit stimulus configuration, bytes, digests, outcomes,
timestamps and cleanup. This Windows/Ryzen 7 5700U run uses Node v24.15.0 and
OpenSSL 3.2.1. Certificates are disposable lab identities, not production secrets.
All experiment settings are authored stimulus, forbidden from Free Mode.

## Campaigns

- Native Node/c-ares queries a loopback UDP A responder. An explicit client-cache
  wrapper reuses the one-second answer during an outage, expires, receives ETIMEOUT
  and then retrieves the changed address. Three wire queries are observed. The
  wrapper is not a production recursive resolver or an OS cache benchmark.
- Real TLS 1.3 accepts the lab SAN under explicit trust and rejects wrong-name,
  untrusted and plaintext clients. Exactly one application payload reaches the
  server. Observed handshake durations are retained as observations, not CPU/service
  parameters. The simulation's identity/issuer labels remain a semantic abstraction.
- Six independent cache cases vary 128/4,096/65,536-byte bodies and coalescing on/off.
  Sixteen simultaneous cold requests use an explicitly injected 20 ms origin hold
  to expose collapse semantics. Warm requests survive a 503 origin; an authored
  TTL reduction plus wall-clock expiry makes a later miss fail, and return refills.
  Each case has 18 successful body responses. Origin fetches are 18 without collapse
  and three with it, including the failed fetch and recovery request. Payload hashes
  and lengths are checked. These are controlled references, not a CDN product.
- A real-buffer HTTP artifact reference verifies SHA-256 uploads/manifests. Three
  shared blobs total 69,760 bytes. First/fresh-node pulls each transfer 4,224 bytes,
  same-node repeat transfers zero, and the second image reuses one layer and transfers
  only its missing 65,536-byte layer. Two manifests and mutable tag state are retained.
  This is not a complete OCI server, image runtime, auth or storage benchmark.
- Explicit HTTP metric collection, a three-sample buffer, two-sample batches and
  bounded attempts generate 13 observations: four exports and nine discarded sample
  identities. Backend failures return 503 in this controlled run, so those missing
  IDs are verified absent. Measurement, collection and arrival times reconcile.
  This is not OTel protocol, durable telemetry or arbitrary logs/traces validation.

## Semantic replay, fit and holdout

`systems-calibration.ts` verifies the source/schema/completion/cleanup boundary and
replays all six CDN byte/fetch populations and the registry missing-layer/storage
populations through actual M2G modules. Replay uses explicit phase-separated synthetic
clocks/deadlines and the authored origin hold so cold requests enter before fills
complete. It does not claim the reference's wall-clock schedule is reproduced. The
agent and native telemetry references independently conserve ownership/timestamps;
their exact schedules are not equated. Native DNS/TLS outcomes are checked alongside
separate deterministic virtual-time mechanism proofs.

**No numerical timing fit or holdout error is claimed.** CPU/crypto/transport/client
attribution has not been identified. Every M2G physical timing predictor remains
**Unknown**. Perturbing native handshake timings cannot change semantic acceptance
or create a fitted candidate; source/byte/cleanup drift fails closed. The reality
ledger records local quantities, scope, units, provenance and forbidden Free Mode
policy. Earlier M2D/M2E/M2F complete timing rejections remain visible; M2F object
timing remains Unknown. No provider/SKU throughput, TLS constant or magic offset is
introduced.
