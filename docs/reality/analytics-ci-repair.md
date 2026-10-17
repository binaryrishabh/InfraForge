# Analytics source compatibility and main validation

Starting main: `0d45ab67d27d3990475868b8669efa5ea4939ee4`.
Previous green source: `d4e742f5ee5d5e6853449245557e840cf31c2fa0`.
The complete product diff is two App.tsx lines, one web manifest dependency and
three lockfile lines: `@vercel/analytics@2.0.1`. No backend, simulation or contract
implementation changed in that merge.

## Root causes

The Model-1 AST inventory hashes every production source and records literal
locations. Adding the Analytics import moved the App.tsx literal down one line;
the stale inventory correctly failed tooling. The lesson endpoint source review
also includes App.tsx, so it correctly rejected the unreviewed current hash. The
workspace review watches the same file and would fail after the earlier integration
failure was repaired.

Execution identity includes the complete root bun.lock. The unchanged historical
v1 compatibility pin therefore rejected the new lock bytes. Refreshing only that
pin is insufficient: connected v2 envelopes and their retained proof previously
required exact current execution-source equality. Changing compatibility metadata
itself changes current execution identity, because that metadata is hashed too.

PR #8's validation completed with these failures before its merge. At inspection,
GitHub returned no rulesets and classic main branch protection returned 404. A red
check was visible but was not a merge restriction.

## Bounded compatibility review

`scripts/review-analytics-lock.ts` parses both locks as JSONC and proves that removing
exactly the web dependency and the new Analytics package record reproduces the
entire previous lock. All **555** old package records, integrity hashes, workspace
dependencies, platform constraints and override data are identical. The new pinned
package has no dependencies or required peers, only optional peers. Negative tests
reject backend/transitive changes and a new dependency on the added package.

The project explicitly uses Bun's **hoisted** linker. A declared dependency graph
alone is not a complete installed-resolution proof: hoisting permits undeclared
imports. Validation therefore also compares clean Bun 1.3.14 installs and backend
bundle inputs/output for the before/after product commits. Source, installer version
and linker configuration must remain fixed for that comparison. The retained proof
replays, fresh integration/lesson runs and packaging exercise the actual executable
path, including dynamic worker/container entrypoints.

Whole-lock hashing is intentionally retained. Excluding the lock or projecting a
new dependency identity in place would change the meaning of accepted identities.
A future versioned identity could include resolved import closure, package integrity,
workspace manifests, platform/optional/peer resolution, Bun version, linker settings,
generated clients and dynamic entrypoints. That design requires explicit migration
and reconstruction tests; it is not substituted into historical identities here.

`legacyRuntime.json` preserves the original v1 baseline, original source digest and
execution inventory. Its current pins are deliberately refreshed after review. A
single `reviewedExecution` entry reconstructs the previous green source
`c978627d82007fc5e55f4bc653ea9132b3f185e381ac0d048afda1645d319ca6`, including
the exact previous metadata text. Frozen texts change storage location, not producer
identity. The runtime checks the complete current execution inventory and pins,
workspace manifests, linker configuration, the pinned Bun version and the reconstructed historical digest before accepting
this one source. Unknown sources and unreviewed drift still refuse.

V2 recompilation compares every rebuilt envelope field with the recorded envelope,
using its reviewed recorded source rather than substituting the current source.
Inputs, compiled hashes, fingerprints, reports, evidence, replay output and producer
commits remain historical. The retained connected verifier additionally pins its
original producer and canonical artifact digest. Fresh proofs require the current
source; arbitrary historical proofs are not grandfathered in.

The identity refactor only exposes its existing file list for the compatibility
inventory check. It retains the same sorting, exclusions and whole-file hashing
algorithm. No engine, metering, budget, supported configuration or model value changes.

## Deliberate refresh versus frozen evidence

Reviewed commands, in order:

```sh
bun --no-env-file scripts/connected-lineage.ts --review-analytics
bun --no-env-file scripts/lesson-endpoint-lineage.ts --refresh-current
bun --no-env-file scripts/m2m-lineage.ts --refresh-current
bun --no-env-file scripts/reality/inventory.ts --write
```

The generator refuses execution implementation changes outside the six reviewed
compatibility/identity/lock metadata files. Current lineage pins advance; existing
original hashes and frozen text remain unchanged. Newly frozen original App.tsx
text reconstructs the same accepted source. The ledger retains 2,570 literals with
the same values and classifications: only reviewed file hashes and line citations
move (App.tsx and the compatibility import in envelopeV2.ts).

The M2K, M2L, M2M and connected proof JSON, producer identities, original lineage
digests, 30 Model-1 goldens and ten challenge hashes are not regenerated. Existing
positive/negative proof verification remains mandatory.

## Merge and release policy

`Full validation` always runs after the matrix and four other groups. Its verifier
requires exactly those five successful results; skipped, cancelled, missing or
failed results refuse. All twelve existing jobs remain unconditional. Tooling tests
exercise failures for every group and check the repository policy.

`scripts/ci/main-protection.json` is the reproducible classic protection request:
strict up-to-date checks, all twelve jobs plus the aggregate, GitHub Actions app
15368 as the check source, admin enforcement, no force pushes/deletions and resolved
conversations. It does not require a second approver for the single-owner repository.
Apply only after the repair's exact-SHA main push is green, then read it back:

```sh
gh api --method PUT repos/binaryrishabh/InfraForge/branches/main/protection \
  --input scripts/ci/main-protection.json
gh api repos/binaryrishabh/InfraForge/branches/main/protection
```

This is hosted enforcement, not a local hook. Normal red merges must be blocked
including for the owner. Main stays the active integration branch. Direct pushes
are subject to required checks too; future unchecked work should use a temporary
PR into main rather than disable protection. No develop branch is introduced.

Release InfraForge already requires a successful exact-SHA main **push** validation,
current-main revalidation, `PRODUCTION_RELEASE_ENABLED=true`, protected Production
approval with no admin bypass and a main-only deployment policy. Manual retry cannot
bypass CI. The switch was false at this repair's initial inspection. A PR validation
or this repair alone is not release authorization.

## Independent sources

- [Bun workspaces](https://bun.sh/docs/pm/workspaces): one workspace install updates
  the shared root lockfile.
- [Bun linker behavior](https://bun.sh/docs/pm/isolated-installs): hoisted access,
  optional/peer resolution and explicit linker configuration.
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches):
  required checks and explicit administrator enforcement.
- [GitHub branch protection API](https://docs.github.com/en/rest/branches/branch-protection):
  strict checks pinned to an app and hosted configuration readback.

Local evidence and the final exact-SHA hosted run, protection readback and deployment
inspection are retained with the task's final report. No production release is
implied by a source or compatibility review.
