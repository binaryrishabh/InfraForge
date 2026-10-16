# M2J: real usage evidence and metering

Internal implementation checkpoint. Model 1 ACTIVE; Model 2 INTERNAL; production PARKED.
No normal product dispatch, visible control, deployment configuration, historical
run or challenge version is changed by this work.

## Research and selected boundary

The missing measurement is inside the mechanism, rather than in a price lookup.
The M2F object service has current state and aggregate counters, but did not retain
the times at which stored bytes changed. Network payload counters did not retain
the transfer identity, direction and terminal boundary needed for interval usage.
Command counts also have different meanings from unique application operations.

Research reviewed on 2026-10-16:

- [S3 consistency](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html#ConsistencyModel)
  distinguishes atomic updates to one key from transactions across keys. The
  existing `atomic-current-object/1` model is a logical single-key mechanism;
  its storage generations are not AWS version IDs or physical durability claims.
- [PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)
  describes whole-object commits. [Conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
  distinguish successful writes from precondition failures. A received request,
  committed mutation and client acknowledgement are three different events.
- [S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)
  retains separately charged complete versions, and [delete markers](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManagingDelMarkers.html)
  are not equivalent to deleting all retained versions. This milestone measures
  the existing current-object profile; it does not add S3 versioning or object lock.
- [Error-response billing](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ErrorCodeBilling.html)
  distinguishes response classes and exceptions. The model's command outcome
  labels do not establish HTTP billing classes. Counting only successful calls,
  or counting one logical retry group as one provider request, would be unsound.
- [Storage classes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html)
  and [billing dimensions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/aws-usage-report-understand.html)
  introduce storage-class, minimum-duration, metadata and transfer distinctions.
  [S3 transfer pricing](https://aws.amazon.com/s3/pricing/) also explains that
  billed transferred bytes can exceed bytes received by a cancelling client.
  Therefore logical object bytes and delivered link payload are not sufficient
  for a new general S3 billing adapter. S3 charges remain Unknown.
- [HTTP idempotence](https://www.rfc-editor.org/rfc/rfc9110.html#name-idempotent-methods)
  concerns intended effects, not the number of actual attempts. Repeated requests
  must retain their own service outcomes even if only one object survives.
- [CloudEvents identity](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md#id)
  scopes identity to a producer and distinguishes duplicate event delivery from
  distinct events. M2J uses source identity, epoch and source sequence; it does
  not deduplicate actual requests by key, content or logical application ID.
- [OpenTelemetry metrics](https://opentelemetry.io/docs/specs/otel/metrics/data-model/)
  distinguishes cumulative/delta temporality and one logical writer. Its resets
  and gaps discussion is marked Development. M2J uses explicit cuts and provenance
  rather than interpolating missing observations or treating a reset as zero.

The selected scope connects the existing compiled M2H product runtime to three
observations: current-object mutations and byte-time, object-command attempt
outcomes, and payload transfers on explicitly selected directed links. It adds
no provider tariff. Application throughput, physical network transfer, storage
durability, provider capacity and full cloud cost remain Unknown.

## Runtime observation boundary

Optional typed ports observe actual service admission/termination, object commits
and directed-link transfer admission/termination. They schedule no extra model
events and do not replace the existing resource implementations. Each producer
has a sequence watermark independently readable by the collector. A complete
capture must reconcile those watermarks and the actual runtime counters/state.

Object origins come from the initialized store. Successful create/overwrite/delete
records carry before/after generation and bytes, tied to their service request.
Rejected writes, failed preconditions and cancelled work do not invent commits.
Overwrite frees the previous current generation; delete frees current bytes.
Logical retention lasts until a real mutation. Access/process failures do not
silently erase objects. Superseded generations retained in evidence are history,
not additional objects occupying the modeled store.

Operation evidence distinguishes receipt, admission rejection, completed/failed
admitted work, cancellation and unfinished work. A server can commit while the
response fails. Actual retries have distinct attempt identities and can produce
multiple service outcomes; repeated delivery of the same evidence record does
not produce another operation.

Network evidence identifies actual modeled link endpoints, path, request/response
direction, hop, call/root/attempt, payload bytes and terminal outcome. Each shared
link is metered once by its owner. Summing hops is explicitly directed-link usage,
not a deduplicated end-to-end transfer or provider egress. TCP retransmissions,
headers, TLS framing, NAT, account allowances and cloud charging are unsupported.

## Cuts, bounds and aggregation

Snapshots carry run/input/epoch identity and producer sequence cuts. Exact cumulative
byte-time is integrated at every mutation, including transient same-time changes;
it is never inferred from sampled object counts. Interval quantities are differences
between compatible cuts, with event populations separated by source sequences.
This preserves boundary events and zero-duration cuts without adding a fabricated
microsecond. Adjacent compatible windows can recombine exactly. Repeated or
overlapping usage windows cannot be added as independent charges.

Evidence has explicit record, field and text budgets. A collector that cannot
retain or reconcile necessary facts marks the measurement incomplete. It must not
continue advertising a known billable quantity after overflow, missing records,
reset, conflicting identity or interrupted execution. Replay may reorder complete
source records and deduplicate identical delivery, but may not invent a missing
record or silently revise an already issued observation.

M2I's reviewed EC2 allocation estimate remains separate. Storage/request/transfer
provider scopes are not inferred from canvas labels. Any authored tariff used to
test aggregation is a labeled arithmetic verification input, not provider coverage.
Price-version changes, unsupported dimensions and incomplete aggregation retain
Unknown. The full infrastructure bill remains Unknown.

## Historical source identity

Runtime ports change source bytes, even when default execution is unchanged.
Historical M2H/M2I artifacts and their old executor measurements must not be
relabeled as measurements of the new implementation. The bounded
`m2j-source-lineage.json` retains original bytes for the small changed source set,
their original/current hashes, the accepted source identities and artifact hashes.
Historical fingerprints can therefore be reconstructed exactly while refusing
unreviewed source drift. Current M2J evidence separately fingerprints the actual
new source, lineage verifier and manifest. Existing compiled inputs and outcomes
must still replay exactly; an identity projection is not a behavioral proof.

This retained source is provenance data, not a second executable engine. No old
proof is deleted or reserialized. New JSON artifacts share an explicit review
budget, including lineage data. Fingerprints detect content drift; they are not
signatures or evidence that an untrusted sender actually executed a model. The
host owns a unique run/epoch and a single writer; independently created executions
must not reuse them. A restart is a new epoch, not a counter reset hidden inside
the previous window. Live operations and in-flight transfers are valid boundary
populations; an execution interrupted by a budget/error is explicitly incomplete.

## Implemented proof and retention boundary

The five retained compiled-product cases cover normal mutation/read/delete,
capacity rejection, lost response after server commit, logical process outage and
recovery, and collector overflow. Each has 33 cuts (165 total), a replayable final
frame, exact input/model/provider fingerprints, and its cumulative window. The
four complete executions recombine all 32 adjacent windows exactly. Their model
and existing M2I provider results match unmetered executions. The incomplete
execution keeps one record and reports Unknown; actual resource work continues.

Targeted tests also execute 512 eight-command schedules against an independent
state/byte-time oracle, actual conditional writes, cancellation, zero-byte objects,
zero-time mutations, two stores, a shared link, live/aborted/partitioned transfers,
duplicate deliveries, missing final records, conflicting duplicates, late records,
resets, missing provenance and field/text budgets. Large-integer byte-time uses
BigInt and remains exact beyond Number's safe integer range. One analytic case
holds 10 bytes until 10 us, 20 until 30 us, 5 until 50 us and zero until 60 us:
10×10 + 20×20 + 5×20 = 600 byte-us. Those changes are actual completed commands.

The retained five-case bundle has 254 source events. The normal executor frame
contains 66 records / 836 fields / 14,488 text characters, serialized as 27,930
bytes. Proof, historical source lineage and current executor measurement together
stay below one MiB. Runtime collector caps are 20,000 records, 250,000 fields and
2,000,000 text characters at most; callers may choose lower budgets. Raw records,
duplicate signatures, active populations and shadow state are bounded by accepted
event fields/records. Issued snapshots/frames are caller-owned exports, so callers
must also bound how many they retain. This is a bounded capture protocol, not an
unbounded production archival service or authenticated ingestion pipeline.

`m2j-performance.json` records actual wall-clock, serialization and replay costs
on the named developer host, with process memory before/after. These measurements
include allocator/runtime state and are not isolated collector heap size, a
statistical benchmark, a physical cloud prediction or pricing input.

Run `bun run check:metering` to reconstruct and verify the retained source-pinned
bundle. Tooling tests enforce its shared budget and current measurement identity.
`bun run debug:metering` deliberately regenerates proof; `bun run perf:metering`
records a fresh host measurement. Review source changes before regenerating.
Historical proof and performance JSON is immutable in this milestone; accepted
M2H/M2I outcomes still replay with the current implementation.

## Rejected alternatives and remaining Unknowns

Periodic samples miss temporary objects and cannot prove byte-time. Deduplicating
by object key, content or root request hides real attempts. Summing overlapping
windows or every route hop as end-to-end egress double-counts usage. A truncated
trace cannot support complete usage just because the final object count is known.
Relabeling old host measurements with new source hashes falsely implies rerunning
them. Each of these approaches was rejected.

No S3 adapter was added. The current-object profile has no S3 version retention,
delete markers, class-specific minimum size/duration, metadata, HTTP billing
classification, provider account allowances or authoritative link-to-cloud billing
mapping. Logical payload is not physical wire traffic or billed egress. The M2I
price validity/location/currency/dimension checks and exact rational money math
remain intact. Unsupported multi-service sums and price-period crossings remain
Unknown; raw observed usage is never silently converted to a price row.

## Next milestone: integrate one real product path

The highest-value next step is **M2K: an internal product-to-Model-2 vertical slice**.
Further isolated provider breadth is not the main blocker. The existing worker
calls `apps/backend/simulator/simulator.ts`, which imports the Model-1 engine;
`deployments/runInputs.ts` rejects other model/catalog versions. RunInputsV2
captures Model-1 topology/workload provenance and does not contain the full M2H
contract, application/demand source identities, provider contract or metering
epoch. The web monitoring store expects Model-1 snapshots and numeric costs.
M2H's internal presentation contract is not wired into that persisted worker path.

Build one explicitly internal saved-design/recorded-workload run through a new,
versioned immutable input envelope, exact compiled/source/provider identities,
worker ownership/interruption handling, bounded usage persistence and a read-only
Observed/Interpreted/Unknown report. Prove saved input → real execution → retained
evidence → report → repeat/recovery, including an object fault/recovery and a
missing-evidence case. Preserve history and refuse unsupported controls rather
than guessing a generic cloud profile. Apply both readiness gates to each exposed
surface; integration does not authorize broad Model-2 activation or reduce 177
technical blockers / 252 UI behavior reviews by declaration. Keep Model 1 ACTIVE,
Model 2 INTERNAL, production PARKED, all existing challenge versions immutable,
the Claude Opus 5.5 visual redesign separate, and eventual verified Model-1
retirement as the destination.
