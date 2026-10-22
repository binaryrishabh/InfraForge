# Historical reads and deterministic prefix verification

Model 1 remains active. Model 2 submission and replay startup remain inactive.
This slice adds compatibility contracts and an explicit retirement rehearsal;
activation and fencing every new-run producer belong to the activation slice.

`historicalRunRecord` dispatches by recorded store. Model 1 V1/V2 inputs keep
their original provenance, including missing provenance. Internal Model 2 input
and capture v1/v2 dispatch explicitly; unknown versions refuse. First-stack
reports retain slice-12 captures, slice-11 verification and the separately
allowlisted stored scored-challenge summary. Readers never execute or resolve a
current design, challenge version or provider tariff. Corrupt components expose
unavailable/Unknown reasons instead of inferred values. Old outer RunRecords
without the new optional reference/availability fields remain readable.

The trusted `HistoricalExecutionPolicy` can rehearse Model 1 retirement while
report reading stays available. Retired exact/current-design rerun options and
challenge improvement sources refuse explicitly. Its shipped default remains
`model1Retired: false`; this is not an activation manifest or a replacement for
the subsequent producer/worker activation fence.

## First-stack replay

An explicitly started submission queue can separately enable historical replay.
The submission router accepts its replay service as an optional third argument;
neither factory is installed by the active API/worker. Historical GET reads are
independent of new submission admission. Replay requests accept an empty body,
select the owned terminal run's latest durable **server** prefix and return an
asynchronous replay ID. Browser-only evidence is unavailable for this operation.
GET and cancel routes check the original owner and replay identity.

The exact recorded source/image must match a qualified pinned executor. The
parent reads only the retained input and compile lock; the isolated child
rebuilds from those recorded bytes and checks the complete lock before creating
a runtime. There is no latest-input/source fallback. Internal v1/v2 retain their
existing source-transition checks and finite internal admission limits.

`FirstStackReplay` provides durable bounded reservations and outbox delivery.
Replays and verification share queue concurrency one, PostgreSQL session
ownership and the fixed daemon container name. Both admission directions count
queued/running/recovery replays against global and owner capacity. At most 1,000
retained replay diagnostics are admitted; exhaustion refuses new requests.
Replay metadata references existing bounded inputs instead of copying them.
Stalled/duplicate delivery cannot restart running work and execution is never
automatically retried.

Replay advances in bounded event slices to the recorded processed-event count,
including prefixes inside an equal-time group. Results are
`MatchesRecordedPrefix`, `Mismatch` with fingerprints/field diagnostics, or
explicit unavailable. This operation never resumes a dead runtime or replaces
the original verification result, report, score, input or capture. The existing
container memory/CPU/wall/output limits, qualification and cancellation fences
apply to replay.

After worker interruption, startup marks running reservations `recovery`.
Capacity remains reserved. An operator must stop the previous owner, inspect
the exact container label/token (the replay UUID), pinned image and daemon,
and remove that container or establish that it was never created. Only then
call the offline `closeHistoricalReplayRecovery` with matching token/daemon,
cleanup, reviewer and proof. This records unavailable and releases capacity;
it never retries or asserts a successful verification.

## Migration lineage and storage

The migration is strictly additive: one replay table/index/function/trigger and
an insert-only migration-lineage guard. Existing tables, records and guards are
preserved. Release checks verify both new trigger bodies and replay constraints;
release preflight requires replay reservations to finish or recover.

A first-stack submission may include a typed Model 1 `{engine,store,id}` source.
Admission verifies ownership and the explicit reviewed design copy. It creates
a new UUID and stores `migratedFrom` in immutable server-owned lineage; the
RunRecord exposes `kind: migrated-from`. The additional insert guard requires
the distinct source/run/design identities. This context is applied after browser
cut validation and never enters its input, lock or fingerprint. It is neither an
exact rerun nor an improvement, and does not rewrite Model 1 history.

## UI work left for the UI slice

- Show read, execution and replay availability independently, including
  `execution-retired` and explicit reasons.
- Keep report playback separate from prefix verification and new-run creation.
- Poll/cancel replay requests and display bounded mismatch diagnostics.
- Label browser-untrusted evidence and stored server verification separately.
- Display migrated-from links as descriptive cross-model lineage.

No UI changes or activation are included here. Linux isolation, database
migration execution and host qualification must be exercised by the lead; local
software tests do not qualify a host.
