# Refresh after an engine change

Keep the full pre-change commit (`git rev-parse HEAD`) before editing. After source
and compatibility review, use this single command from the repository root:

```sh
bun --no-env-file scripts/refresh-execution.ts --baseline=<full-pre-change-commit> --review="<reviewed change, scope and compatibility evidence>"
```

Install with `bun install --frozen-lockfile` first. Bun is pinned to 1.3.14.
The command generates Prisma, reviews privileged import edges, builds loading
analysis, updates only its generated pin review, builds installed resolution,
rebuilds analysis against that selection, refreshes connected/M2M/lesson lineage,
records the transition, regenerates launch/run-record/shipping/reality artifacts,
then checks identity and installed resolution. Steps run sequentially and stop on
the first failure. Source with changed syntax capabilities still needs its own
exact-source review; this command does not grant permissions or approve engine
behavior. Read the generated diff, run affected tests and the required CI checks.

The previous target must reconstruct from the supplied committed baseline and
verified generated outputs. Every older row and snapshot remains present. A new
row retains the previous descriptor, full source closure, manifests and lockfile;
historical targets are redirected only by this explicit reviewed operation.
Repeated source values at different historical commits remain separate rows.
An uncommitted refresh can be repeated against the same baseline. After committing
a transition, the next change needs a new baseline. Changed loading policy needs
a separate review; the helper permits only a generated `analysisPin` change.

For storage-only regeneration, including shallow clones without historical Git
objects, run:

```sh
bun --no-env-file scripts/transition-store.ts --regenerate
bun --no-env-file scripts/execution-identity.ts --check
```

This must reproduce all three storage files byte-for-byte (text compared with LF
normalization). It does not create a transition. Earlier stage-specific transition
commands remain scoped historical review tools; they now use the same storage
writer. Use the command above for subsequent engine changes rather than repeating
their old refresh recipes.

# Storage contract

`executionTransitions.json` is the canonical version-2 manifest: ordered rows,
first/last anchors, unchanged original descriptor digests mapped to Merkle roots,
and complete commit-to-snapshot directory roots. `executionNodes.json.gz` is one
sorted flat pack. `transitionPin.json` pins the reconstructed version-1 table
digest, LF manifest bytes, domain-separated manifest root, exact pack bytes and
sorted node index. There is no second history archive.

Nodes use explicit object, array, text and chunk tags. Objects sort keys by ordinal
comparison; arrays retain order; references cannot be confused with authored
reference-like arrays. Node SHA-256 uses the `execution-merkle-node/1` domain.
Text is LF-normalized before content-defined chunking, so generated source text
shares unchanged chunks as well as unchanged files. Snapshot directories share
subtrees. Gzip has fixed level 9 and OS marker 255 for Windows/Linux parity.

The reader rejects unknown tags, duplicate or unordered nodes/keys, invalid hashes,
cycles, dangling references, unreachable nodes, index/byte/root drift, conflicting
or cyclic mappings, duplicate commits, unsupported algorithms and snapshot coverage
drift. Tooling expands every original descriptor and reruns its frozen source,
closure and whole-lock reconstruction, then verifies current installed resolution.
The decoded pack has a 128 MiB limit and graph traversal has a depth limit.

`transition-storage-migration.json` records all 42 pre-migration row digests
(excluding only the replay target), 28 original descriptor digests and 42 complete
snapshot inventory digests. Before adding the storage implementation transition,
`scripts/transition-store.ts --prove-legacy=6e0466de089875fe53e4040325bb8c0ca51bc0cd`
proved complete table equality and every retained source string against the old
table/archive. The storage tests keep verifying those originals without old Git
objects. The new transition is a separate reviewed row; identities are not relabelled.
