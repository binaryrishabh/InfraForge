# Model 2 execution identity

New processes use the SHA-256 digest of canonical JSON with domain
`execution-source/2`. The envelope still stores a 64-character hexadecimal source.
Model 1 and persisted inputs, evidence, producer identities and accepted proofs are
unchanged.

The descriptor pins Bun's version, LF-normalized execution source hashes, workspace
exports and runtime manifests, install configuration, and the resolved Bun lock
graph. Its roots are simulation, domain, catalog and contracts, plus the real API, worker, WebSocket and sandbox hosts and their transitive backend
imports, including injected WorkerOwnership implementations. It includes
contracts source, the explicit sandbox child entrypoint and imported backend
source outside the original inventory. Registry instances include name, version,
integrity, full metadata, dependency and peer edges, nested assignments, platform
constraints and applicable overrides. Optional peer absence is explicit. All
platform records are pinned so the identity is portable across the supported
runtime images. Physical hoist paths resolve the graph but are replaced by stable
traversal identifiers; moving an unchanged instance preserves identity while
distinct instances, cycles and singleton sharing remain represented.

Web manifests, web-only lock records and unrelated development dependencies are
excluded. A change that moves a shared dependency's resolved instance or supplies
an execution optional peer is an execution change, even if initiated by the web.
Unknown lock schemas/settings, unresolved dependencies, undeclared authored imports
and unreviewed install hooks fail closed. Workspace entrypoints support strings and
`types`/`default` maps; other runtime conditions require explicit resolver review.

Every authored module inventories ancestor `tsconfig.json`/`jsconfig.json` files
and local `extends` chains. Aliases, alternate resolution conditions, package-based
extends and custom JSX factories are refused. Workspace targets must match Bun's
actual resolution. TypeScript, TSX, JavaScript, JSX, MJS/CJS and MTS/CTS imports are
traversed, including emitted imports. The build checks the hash and membership of
every authored module it observes; unsupported executable formats fail closed.

Install validation covers the root and all workspaces matched by its install
patterns, including web. Install, prepare, uninstall, publish and pack lifecycle
phases are refused, including their pre/post phases. Unrelated web manifest fields
are validated without entering the descriptor.

Startup verifies actual package locations, names, versions, edges and optional
peer absence inside the runtime tree. `scripts/execution-resolution.ts` additionally
compiles the execution entrypoints without executing them and checks installed
package imports against those edges. Bun's Windows paths are normalized explicitly.
BullMQ's undeclared optional Valkey adapter is inventoried, including its absence.
The Express view-engine loader and BullMQ child-processor loader are reviewed by
exact file hash; this execution uses routers and a function processor, respectively.
New dynamic loading requires review. Installation must use the committed lock with
`bun install --frozen-lockfile`; these checks do not attest arbitrary modifications
to installed package contents. Runtime images retain their separate provenance.

One shared AST policy rejects loader factories, escaping `require`, computed
host-loader access, constructor/reflection access, VM/inspector evaluation, worker
entrypoints and subprocess loaders in authored and installed code. The authored
Docker adapter and error stack-trimming helper are exact-hash reviews; edits need
another review rather than inheriting a path-wide exemption.
The parser (`acorn`) is an explicit pinned backend dependency. Installed exceptions
are exact file hashes in `loading.ts`: BullMQ/Express entrypoint loaders; Msgpackr's
declared optional native adapter and its native resolver; Zod/Msgpackr/depd/bind
generated wrappers; fixed intrinsic/prototype helpers; tslib/global registries;
and ioredis's fixed diagnostics-channel lookup. These files were reviewed at their
call sites, as were class metadata/factories, descriptor copying, Redis forwarding
and the native libc probe's fixed platform commands. Native artifacts still require frozen installation and image provenance;
this is a source/dependency identity, not an attestation of arbitrary machine files.

Containment fixtures replace the sandbox child in an immutable derivative image.
Their harness derives and records that replacement's descriptor digest and supplies
it as a trusted readiness pin, including the orphan-parent check. Production callers
use the current execution identity by default; a child cannot choose its own pin.

`executionTransitions.json` records every whole-lock source on the connected/v2
ancestry from `72bb3a2` through migration baseline `1d4b321`, plus the v1 source
`bac35c99â€¦`; it includes the reviewed `c978627dâ€¦` source. Each row preserves the
historical descriptor digest and an explicit reviewed replay target. Different
historical descriptors are not presented as identical source. Reviewed differences
are the existing v1 adapter, capture corruption-check ordering, compatibility code,
and sandbox/client supervision. The modeled connected engine and resolved runtime
dependencies are checked unchanged. Replay still recompiles inputs and compares
retained captures, preserving their recorded source and fingerprints.

The old whole-text algorithm and `legacyRuntime.json` remain frozen. The table,
descriptor hashes and compressed content-addressed historical snapshots are pinned;
CI reconstructs every source and descriptor without Git history. Unknown sources
are refused. Historical documentation/table additions do not redefine execution.
Runtime and tooling use the same loader for normalized table bytes and canonical
digest validation. The first v2 digest `dcf73daceâ€¦` has an explicit reviewed row
for its committed engine; its descriptor and original 21 historical rows
are preserved using the frozen original descriptor algorithm in tooling.

Commands:

```text
bun --no-env-file scripts/execution-identity.ts --build-transitions
bun --no-env-file scripts/execution-identity.ts --check
bun --no-env-file scripts/execution-resolution.ts
```

Building transitions reads Git history and is an explicit review operation, not a
routine dependency-install step. Its migration guard permits identity machinery
changes only. Future engine changes need a new reviewed transition decision;
never redirect old sources automatically or rewrite recorded data. Lesson/workspace
lineage pins are refreshed only with their existing scripts after source review.
Old lesson images must still match their recorded image identity.

Source text, emitted imports and loader analysis are cached by exact contents
within a process. Each invocation rereads sources and configuration; installed
path probing is deduplicated only within that synchronous verification. Children
perform their own verification. This saves repeated analysis without trusting a
parent digest or persisting filesystem results across checks.

Root test defaults and the historical tests remain unchanged. The new negative
test that performs two full builds has its own explicit timeout.

Boundary hardening (October 2026): every unreviewed module is parsed; there is no sensitive-token
shortcut. Unknown computed property reads can recover reflective capabilities even
from ordinary data objects, so they are refused. Existing data indexing is reviewed
by exact authored-file bytes in `capabilityReviews.json`; these permissions authorize
computed data access only, not loader factories or resource access. Core verification,
four generated Prisma modules and the import/require resolver have separately scoped
exact-byte reviews. Changing reviewed bytes requires another review. The Prisma schema,
config, generated runtime bytes, locked generator dependency closure and migration SQL
are descriptor inputs. Generated files are produced in the image, never copied from the
checkout.

The closed launch contract requires Bun 1.3.14 and `--no-env-file`; additional conditions,
preloads, eval/print wrappers, defines, hot reload and unknown flags are refused.
`BUN_OPTIONS`, `NODE_OPTIONS` and `BUN_PRELOAD` are refused. Runtime bunfig settings
and nested bunfig scopes are refused. Dockerfile, Compose and .dockerignore are hashed;
shipped host commands use `executionIdentity/launcher.ts`, which verifies identity
before importing the host. Runtime configuration comes from the supplied environment;
backend config and Prisma config no longer discover dotenv files.

`resolutionContract.json` pins selected installed module bytes and every observed import
edge, including distinct import/require entrypoints. Startup verifies those bytes and
resolves the recorded edges again. Compilation checks the real hosts, launcher, resource
API and internal modules against the same authored inventory and selected implementations.
Installed implementation exceptions match both module key and exact file hash, including
multiple versions of one package. `--build-contract` is an explicit dependency review
operation: it records the selected implementations, not an install or startup shortcut.
Frozen installation and image provenance still cover native adapter artifacts and OS
facilities; arbitrary mutable runtime files are not an execution input facility.

New filesystem/SQLite/WASI reads, Bun host APIs, WebAssembly and file-fetch capabilities
are refused outside exact reviewed adapters. Existing exceptions are identity/transition
verification, migration/schema checks, release metadata, Docker socket ownership and
cgroup/proc containment probes. These are not path-wide exemptions. Application data
resources use `executionResource` or `compileExecutionWasm` with paths enumerated in
`resourceInventory.json`. JSON/WASM bytes are hashed without UTF-8 loss, and rechecked
when read. Unknown paths fail closed, including environment-selected paths. Ordinary
network/database requests and sandbox stdin remain external request inputs at the
reviewed hosts; they do not provide a new source/resource loader.

The boundary transition preserves the `13dfdafc…` descriptor from `2da5b74` as its
23rd historical row and freezes that descriptor algorithm separately in tooling.
Original recorded sources, descriptors and snapshots remain intact. The new replay
target represents the reviewed boundary tightening: modeled engine, lock, host behavior
and schema are unchanged; dotenv discovery is removed and supplied environment retained.
The generator is rerun and its runtime bytes are pinned. Regenerating the boundary table
only accepts source equality with that committed baseline apart from these named changes.

Review commands, before the ordinary checks:

```text
bun --no-env-file scripts/execution-resolution.ts --build-contract
bun --no-env-file scripts/execution-identity.ts --build-transitions
```

The boundary regression fixtures use in-memory source trees and resources. Transition-byte
fixtures also use injected in-memory reads. The fresh-process launch probe is committed
under `scripts/tests/fixtures`. Identity tests have explicit budgets for the larger host
closure; global test timeouts are unchanged.

The existing immutable Linux containment probe has its own exact-byte `trusted-fixture`
review, restricted to the sandbox child path. Its deliberate read-only/network/PID probes
are not production permissions, and changing even a comment invalidates the review.
The committed `fe8fd0f1…` host descriptor is preserved as row 24 (commit `20af730`),
using a frozen host algorithm with archived review/selection data and verified generated
bytes. The final replay target adds this fixture review only. The numeric source ledger
is refreshed with the existing inventory script after the boundary source review.

Resource/loader privileges also propagate over the resolved authored import graph,
including re-exports and registry APIs. All 99 current consumers have exact-byte
import reviews in capabilityImportReviews.json; unreviewed consumers fail closed.
Only two exact reviewed facades stop propagation: identity/hash metadata and the
inventoried resource API. Thus generic diskTree, Docker/process adapters and package
wrappers cannot become new resource/loading APIs through aliases. New privileged
call sites require an explicit source review with:

    bun --no-env-file scripts/execution-capabilities.ts --review-imports

The builtin data-only interface list is closed. Import-meta loader access/aliasing,
Error stack-hook capabilities and legacy function caller/callee access are refused;
existing model caller data fields remain exact-byte reviews. Literal require.resolve
is inventoried with its own runtime resolution kind. Row 25 preserves committed
26b81b30… (23203fa) before these further policy changes. A table rebuild retains the
committed HEAD target; uncommitted intermediate descriptors are never historical sources.

The readiness-only supervision unit probe has a second exact child-import alternative;
new probe bytes are refused. Row 26 retains committed 3886e64e… (53188f7) before this
review-data addition. Its frozen reconstruction adds the explicitly inventoried import
review file to the preceding host algorithm. No engine or dependency implementation changed.

Intrinsic Symbol values cannot escape or be replaced by unreviewed code; otherwise a
forged Symbol.iterator could turn the fixed-symbol exception into constructor access.
The split-key and forged-intrinsic cases are both negative regressions.

Actual entrypoints are closed to the shipped hosts, explicit metadata tools and test
contexts. Runtime host working directories are constrained. Claim/commit workflows
require the real worker or its worker launcher role; a metadata/test driver cannot
inject an alternative ownership implementation. These checks execute before database
access. Row 27 retains committed 421000e5… (c1edd9f). The workflow transition guard
accepts only the mechanically added host checks; all prior workflow bytes remain equal.

Known tooling and explicit disposable integration drivers are metadata-only contexts;
worker startup itself also checks its host before opening the ownership session. They
cannot turn a test/tooling main into the worker claim/commit implementation.

Installed verification deduplicates identical directory/specifier/kind resolutions and
physical-path probes only within one invocation. Equal absolute names need no second
realpath lookup; every selected module byte hash and every edge target is still checked.
Regressions cover distinct import/require targets and a conflicting second target in a
shared resolution context. Row 28 preserves f4890c84… (4c92f13), including its static
launch data; no verification result is persisted or inherited by another process.

Free identifiers in execution code must now belong to the explicit, reviewed
executionGlobals set in loading.ts, derived from the authored closure's actual
built-in usage. Unknown global aliases are refused, including in typeof checks.
Imports, parameters, destructuring, declarations and catch bindings are resolved
lexically; property names, labels and export names are not variable references.
Function parameter initializers, switch discriminants and class static blocks
retain their separate scopes. Existing host access to process, Bun and WebAssembly
requires exact bytes and specific names in the globals capability reviews; a
computed-data review alone does not grant host globals. Generated and resolver
exceptions retain their existing exact-byte reviews. Row 29 preserves committed
b0438907 (f8e7c33) with the frozen launch-boundary algorithm; engine, host
implementation and dependency bytes remain unchanged.

CI source verification requires Prisma generation after the frozen install. The
checker never imports application modules: diskTree resolves their literal imports
and reads the actual generated runtime as part of the hashed closure. Substituting
expected generated hashes when output is absent would omit verification of the
build's output. CI therefore generates first, then runs both identity checks.

Source hashes use sourceHash (LF normalization); canonical data, resource bytes
and frozen historical algorithms keep their separate byte/content contracts.
Authored review, importer, descriptor and installed-module checks share this source
rule. The bounded lesson-host enforcement fixture is distinct from the integration
containment fixture and has its own exact alternative review; changing either
fixture still fails closed. Row 30 retains the committed 435856da descriptor from
91654e8 using the frozen launch-boundary reconstruction.
