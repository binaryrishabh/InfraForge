# Finite non-cache fault and retry scenarios

Model 1 remains active. This internal qualification path adds no public executor,
activation or timing promotion. Timing remains assumption-only; full memory and
full cost remain Unknown. Cache lifecycle and policy children await slice 08.

V1 sidecars remain review-only with an empty fault tuple. V2 accepts up to 64
`first-stack-fault/1` commands: `app-process-crash`, `directed-delay` and
`directed-partition`. A crash names one initially alive/ready compute app and
explicit positive downtime and recovery delay. The process returns at
`atUs + downtimeUs + recoveryUs`; a later successful DB-backed LB health probe
must restore eligibility. Link commands name one explicit directed link. Duplicate
IDs, overlapping owner intervals (including recovery), out-of-horizon commands,
DB/cache/LB crashes and CPU competitors refuse. Shared-host CPU competitors have
no host-level policy and remain unavailable.

A process crash gates admission, pauses and aborts its primary work, resets incoming
and outgoing connection pools (closing DB sessions and settling transport receipts),
checks that the primary owns no live work, and retires its clock generation and
CPU/memory leases. Recovery registers a new generation and leases while preserving
cumulative observed CPU accounting. This fixed-membership compute adapter does not
force-retire arbitrary live resources. There is no cache policy role in this profile.
LB health epochs discard old probe successes, including probes spanning a crash.

`first-stack-read-retry/1` is an optional, explicit single-LB-owner overlay. It
requires a foreground point/range read allowlist, exactly two maximum attempts,
positive deterministic backoff, a finite concurrent retry ceiling and no recursive
retry layer. Health and writes cannot enter the allowlist. Ambiguous writes never
auto-retry; non-allowlisted operations do not retry even on unambiguous failures.
Backoff that reaches the original caller deadline cannot launch another attempt.
All attempts preserve the original recorded row and exact keys, traverse the same
pools/links and consume the existing event/live-call budgets. Preflight exposes
two possible attempts while retaining an Unknown event/RSS forecast.

The compile lock captures the entire scenario. Returned evidence contains the
ordered command log, retry policy and equal-time ordering; the bounded causal
journal records crash/readiness generations and actual health/attempt outcomes.
At equal timestamps, faults run at priority 0, deadlines at 1, commits/completions
at 2, health/retry at 3, then lexical event key breaks ties. In this generic
read-committed profile, closing the app's DB session before an equal-time commit
aborts it; an earlier committed write remains committed after response loss.
This does not change the separately versioned PostgreSQL protected-commit policy.

Proofs and acceptance:

```
bun --no-env-file --no-install test scripts/tests/first-stack-faults.test.ts
bun --no-env-file scripts/reality/first-stack-fault-proof.ts
bun --no-env-file scripts/reality/first-stack-compile-proof.ts
bun --no-env-file scripts/reality/first-stack-bounds-proof.ts
bun --no-env-file scripts/reality/composition-proofs.ts
bun --no-env-file scripts/reality/composition-host-proof.ts
```

`first-stack-fault-host.json` separately retains exact pre-fault host text and pins
current host changes, validated by `stage2-fault-host.ts`. The original Stage 1,
PostgreSQL and bounds baselines remain untouched. Current compiler/bounds proofs
write new `first-stack-faults-compile-proof.json` and
`first-stack-faults-bounds-proof.json`, preserving the prior artifacts.
`first-stack-fault-proof.json` pins five crash/shared-host/link/write cases and
repeated/observer equality, with independent acceptance for equal-time commit and
completion, multiple generations, cleanup, refusal and retry conservation.
Use each producer's `--write` only after review; regenerate the fault host review
before source-review/identity refresh. Follow the analysis/import/resolution,
lineage, Stage 2 review-lock/transitions and generated-inventory order in
`first-stack-bounds.md`. No local measurement campaign is required by this slice.

UI needs: immutable command/retry review, directed link selection, separate process
readiness and health eligibility timestamps, root/attempt/commit reconciliation,
field refusal diagnostics and evidence/Unknown labels. No UI design is included.
