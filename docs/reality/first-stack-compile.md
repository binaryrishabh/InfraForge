# Cache-free first-stack compiler

Sidecar `infraforge-first-stack-sidecar/2`, compiler `first-stack-compiler/2`
and composition `first-stack-composition/2` add an internal qualification path
over the unchanged Stage 1 registry and host budgets. Model 1 remains active.
There is no first-stack HTTP run endpoint, worker dispatch, public admission,
retained run store or frontend change. Timing remains assumption-only; logical
counts are supported-logical; full memory and cost remain Unknown.
Sources: `packages/contracts/src/first-stack/index.ts:57`;
`packages/simulation/src/firstStack/run.ts:6`; `apps/backend/firstStack/routes.ts:40`.

V1 sidecars retain their original strict schema and authoring-only behavior.
They cannot compile. A V2 copy must explicitly supply directed link endpoints,
serial pool reuse/establishment/acquire/connect/response/idle/cancellation policy,
resource alive/ready state, initial LB eligibility, health timeout and health keys.
The saved immutable-sidecar/copy rules also apply to changing V1 into V2;
there is no automatic upgrade or inferred establishment/readiness default.
V2 workload references also pin the resolved identity and executed-schedule hash,
so recomputing a content hash cannot substitute rows under the old reviewed pins.
Sources: `apps/backend/firstStack/authoring.ts:54`;
`apps/backend/firstStack/service.ts:59`; `apps/backend/firstStack/execution.ts:32`.

`POST /api/internal/model2/first-stack/compile` is operator-only, checks owned
saved-design timestamp/revision and the pinned resolved workload, and returns
`executable: false`, a compile lock and the typed Stage 1 inputs. It allocates
no runtime and writes no design/run/Outbox data. In-process qualification uses
`prepareFirstStackExecution` and `runFirstStackQualification`; this is trusted
tooling, not a public executor. Workload identity, executed rows, demand profile,
schedule/parameter references and post-review mutation are checked before work.
Sources: `apps/backend/firstStack/routes.ts:40`;
`apps/backend/firstStack/service.ts:35`; `apps/backend/firstStack/execution.ts:27`.

The graph is one logical LB, 1..8 compute apps and one read-committed keyed
relational database. Each app owns a compute primary and an explicit DB path.
Point reads, fixed explicit range reads, independent updates and hot-key updates
use finite authored DB plans. Health is a separately identified read-only
DB-backed operation. An input plug-in supplies each recorded row's exact keys
at LB/application entry and explicit health keys at app entry. Child transport
copies that message through the same compute/network/DB mechanisms.
Sources: `packages/simulation/src/firstStack/compiler.ts:21`;
`packages/simulation/src/firstStack/run.ts:19`.

This revision refuses CPU-only and cache operations, varying bytes within one
operation and varying recorded range lists within one range operation. Diagnostics
ask for explicit byte classes or fixed reviewed range plans. It never encodes keys
as application operation names, chooses fallback keys, infers SQL or drops
security/controller settings. Each path's authored bytes are envelope bytes;
recorded operation request/response bytes are body bytes, added exactly once per
hop. All numeric inputs carry ledger provenance. The logical LB explicitly reserves
zero memory because it has no physical demand owner. Process memory remains
Unknown; compute/DB reservations use the host memory owner and co-located CPU
members share one scheduler and one authoritative available-core-time denominator.
Sources: `packages/simulation/src/firstStack/compiler.ts:24`;
`packages/simulation/src/firstStack/compiler.ts:98`;
`packages/simulation/src/model2/composition/run.ts:46`.

Reproduce the separate proof with
`bun --no-env-file scripts/reality/first-stack-compile-proof.ts`; after a reviewed
change use that producer's `--write` flag. Its authored 24-root schedule is shared
by the 1/2/4/8-app cases. The artifact pins compiled inputs, evidence, routing,
foreground/health commits, contention and repeated/observer byte equality, plus
the shared-host case. It does not establish cloud performance or safe public
executor capacity. The eight historical composition hashes and all 88 Stage 1
host/peer source hashes remain frozen. Verification is also in `test:tooling`.
Sources: `scripts/reality/first-stack-compile-proof.ts:9`;
`scripts/tests/first-stack-compile.test.ts:25`;
`scripts/reality/composition-host-proof.ts:18`.

UI handoff: the lead needs a reviewed-copy upgrade form for directed links,
pool/readiness/health settings; immutable workload and compiler-lock inspection;
field-specific refusal presentation; and explicit evidence/Unknown labels. Public
run controls depend on later execution-host containment, admission and retention.
No visual design is included here.
