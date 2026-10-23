# Historical evidence and current execution checks

Historical evidence describes a reviewed version. It does not authorize later
source changes or attest that a browser honestly ran a simulation. Current source,
installed resolution, launch restrictions, immutable inputs, server execution,
cleanup and fingerprint comparisons remain the release/verification boundary.

## Pin ownership

| Pins | Meaning and maintenance |
| --- | --- |
| `apps/backend/executionIdentity/capabilityReviews.json` | **Active security gate.** Exact source hashes authorize loading syntax, globals and narrowly reviewed adapters. A historical receipt never supplies current permissions. |
| `apps/backend/executionIdentity/capabilityImportReviews.json` | **Active security gate.** Exact source hashes authorize privileged imports and reviewed facades; privilege still propagates through the import graph. |
| `analysisContract.json`, its `loading.ts` pin, `resolutionContract.json` | **Active checks.** Full current analysis regenerates the contract; installed module resolution and actual bytes remain checked. |
| `executionTransitions.json`, `transitionPin.json`, `executionNodes.json.gz` | Authenticated historical descriptors/snapshots and explicit reviewed replay targets. Retarget only through the compatibility review and refresh workflow. |
| `execution-history-anchor.json` | Independent immutable ordered inventory of the history retained at this migration. Its digest lives in `scripts/history-preservation.ts`, independently of the transition writer. Append new rows; do not regenerate the anchor. Original rows (excluding only replay target), descriptors and complete snapshot inventories must survive. |
| The eleven `docs/reality/*source-review.json` receipts | **Historical slice attestations.** Each receipt retains its original bytes, source hashes and acceptance hashes. Verify those hashes against `historical-slice-snapshots.json.gz`, not against later source/tests. Do not repin unrelated receipts during merges. |
| Original/current pairs inside finite-IO, PostgreSQL and cache receipts | Also inputs to **active historical projection checks**. Those readers still reject unreviewed current mechanism changes before reconstructing old behavior. Archiving the receipt does not remove or broaden these checks. A mechanism change still needs an explicit compatible projection or separately supported historical executor. |
| `frozen-artifacts.json` and the archived proof/snapshot bytes | Immutable evidence storage. The reader independently pins the manifest and verifies both compressed and decoded digests and lengths. Existing lineage hashes still verify the same decoded proof text. |
| `apps/web/src/firstStack/enginePin.json` | Current browser execution source. Regenerate only after a successful final execution refresh. |

## Slice reviews

Run `bun --no-env-file scripts/historical-slice-reviews.ts` to authenticate every
receipt and its source/acceptance snapshot without Git or a historical checkout.
The eight standalone account, submission, isolation, report, cost, compatibility,
scored-challenge and R1 review commands now perform read-only historical checks;
`--write` fails with maintenance guidance. Their complete original scope-checker
sources are retained in the same authenticated archive for audit.

The old multi-purpose Stage 2, finite-IO and PostgreSQL reconstruction tools remain
scoped historical tools. Their projections are still used by current regression
checks. Do not rerun their old receipt writers as a merge recipe: any historical
receipt rewrite fails the archive's independent digest check. Current behavior is
covered by the live application/simulation/tooling tests; changing those tests
does not rewrite what the older slice was accepted against.

For a current change: review its source and any exact capability/import changes,
run affected current tests plus the tooling suite and local CI, then use the
[execution refresh](execution-refresh.md) with a full valid baseline and explicit
compatibility evidence. Check its exit status before running
`bun --no-env-file scripts/browser-first-stack/pin.ts --write`. A historical
attestation cannot replace any of those current checks.

## Lossless proof archives

The M2D–M2H proof JSONs are stored as `.json.gz`. All consumers use
`scripts/reality/frozen-artifacts.ts`; `readProofText` accepts their original
logical `.json` path, and `readArtifactText` supports a supplied repository root.
No network, historical Git objects or external artifact service is needed.
The decoder authenticates compressed bytes, enforces a 16 MiB compressed limit,
uses the pinned decoded length as the decompressor allocation bound (at most
32 MiB), verifies decoded SHA-256 and length, and validates UTF-8 and JSON.
Missing archives, corrupt streams, altered manifests and ambiguous plain copies
fail closed. Existing generators may reproduce identical evidence but cannot
overwrite it with a newer engine's output. New evidence needs a new artifact.

This storage change does not compress or regenerate active inventories, remove
numeric classifications, truncate proof details, or change any lineage identity.

## Full historical reconstruction

The checker still authenticates the manifest, every Merkle node and blob, the
complete snapshot inventory and every descriptor. It reruns the frozen closure
algorithm for each unique algorithm/runtime/snapshot input and compares the result
to each row's authenticated descriptor; whole-lock source identities are still
checked for every row. It then verifies current installed execution.

One synchronous check invocation may reuse successful module analysis keyed by
the frozen algorithm, full path, exact content digest and complete matching
historical review (including alternatives and globals). Content hashing is memoized
by the entire input string. Repeated snapshot reconstruction is keyed by the
algorithm, runtime and full path-to-verified-blob inventory. No disk cache or
caller-supplied successful result is trusted; failures are not cached and caches
are cleared on success or error. Changes to any key force reanalysis.

The history test runs the complete checker once in a clean subprocess with no Git
on `PATH`, rather than running the identical checker twice. Mutation rejection,
unknown-source rejection, independent historical preservation, installed loading
and all other current security tests remain. The laptop measurement fell from
140.02 seconds to 17.17 seconds for the targeted history test.
