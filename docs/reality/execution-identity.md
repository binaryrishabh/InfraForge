# Model 2 execution identity

New processes use the SHA-256 digest of canonical JSON with domain
`execution-source/2`. The envelope still stores a 64-character hexadecimal source.
Model 1 and persisted inputs, evidence, producer identities and accepted proofs are
unchanged.

The descriptor pins Bun's version, LF-normalized execution source hashes, workspace
exports and runtime manifests, install configuration, and the resolved Bun lock
graph. Its roots are simulation, domain, catalog and contracts, plus the backend
dependencies imported by `internalModel2` and its local imports. It includes
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

One shared token/AST policy rejects loader factories, escaping `require`, computed
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
`bac35c99…`; it includes the reviewed `c978627d…` source. Each row preserves the
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
digest validation. The first v2 digest `dcf73dace…` has an explicit reviewed row
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
