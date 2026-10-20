# Finite logical IO revision 1

`postgresql-keyed-io/1` implements the slice 07a proposal through the internal
`first-stack-io-compiler/1` / `first-stack-io-composition/1` qualification path.
Model 1 remains active. Counting is supported-logical; timing is assumption-only.
The draft schema and G4 observations remain historical authoring evidence, not
an executable input or calibrated per-query demand source.

The executable TypeScript contract is `data/io-contract.ts`. Every quantity
has a unit and observed/authored source, revision, domain and evidence label.
Required null quantities refuse admission with their reason. There is no silent
assumption bundle. Sourced authored zero is permitted for read-only WAL and
flush demand. Existing transaction CPU stays on its independent CPU owner;
existing blocking wait remains separately authored. Neither is derived from G4
aggregate CPU or transaction latency. The profile/workload identities and full
canonical profile content are captured in the compiler output and run evidence.

Each generation-scoped device has one FIFO lane. Service microseconds are
`ceil(max(1e6 / IOPS, bytes * 1e6 / bytesPerSecond))`, plus authored flush
microseconds for flush operations. Only concurrency one is admitted. Queued
operations and bytes have independent limits; a demand larger than the byte
limit refuses immediately. Queue limits exclude the currently servicing
operation, so outstanding capacity is at most queue capacity plus one service
operation. All relational roles and bounded background work use this owner.
Read, WAL, flush and background receipts preserve their separate classes,
role/request/transaction/operation identities and generation.

Accepted operations and bytes each equal queued + servicing + completed +
cancelled-before-service. Queue refusal is a separate count. Started work cannot
be erased by cancellation. Receipt/waiter ceilings fail explicitly as executor
exhaustion, never as a partial successful proof. Integer/time overflow refuses.
FIFO service order follows deterministic arrival order on the common clock.
Fault/background priority 0 precedes deadlines/cancellation priority 1, which
precede completion priority 2. Completion starts older queued work before its
callback can submit more. A timeout tied with page completion therefore rolls
back first; a timeout during protected commit cannot erase the commit. Row lock
release occurs at transaction terminal and then grants existing waiters.

Buffers have explicit ordered pages for every finite key/transaction binding,
one sequence per statement. No row-byte-to-page inference is performed. Clean
page LRU hits avoid a read; misses coalesce one read with independently removable
waiters. A queued read with no waiters cancels once. A started read completes and
installs one page even if all callers detach; a later caller may join it. Capacity
is a separate host memory lease, counted once across attached roles. Full RSS
remains Unknown. Relational retirement refuses live device work; storage retires
only after all bound relational roles, scheduled background work, service and
waiters settle, then releases its buffer leases exactly once.

Statement page work runs after independent CPU service and lock acquisition,
before the separately authored blocking interval. Updates preserve finite keyed
read-committed semantics; locks stay distinct from device delay. Per-transaction
phase totals/populations distinguish DB admission, CPU, lock, IO, blocking and
commit. CPU phase includes scheduler contention; IO includes coalesced waiting.
Transport retains its pool wait; device receipts retain queue/service durations.
Overlapping populations must not be summed into elapsed wall time.

WAL bytes must equal the plan's declared log bytes and are divided deterministically
across its explicit operation count. A local acknowledgement issues WAL then a
zero-byte flush; zero-byte operations still consume the IOPS calendar. The
protected commit chain belongs to the device and survives caller timeout/session
close. Logical-only acknowledgement may precede remaining WAL; subsequent
queue refusal is an explicit incomplete-execution failure. Local-ack queue
refusal aborts the logical transaction without erasing previously issued IO.
No group commit, dirty pages, checkpoints, optimizer, vacuum generation, OS cache,
crash durability, physical recovery or physical hit-rate model is supplied.

Background interference is either an explicit bounded sourced schedule or
excluded-unknown. A rejected scheduled operation is retained by the rejection
counter. Total physical demand, recovery and physical hit rate remain null with
reasons even when the declared logical schedule completes. No G4 coefficient or
historical timing rejection is promoted. Managed/cloud storage is unsupported.

`bun --no-env-file scripts/reality/finite-io-proof.ts --write` produces the retained
cold/warm composition and database/WAL/cancellation proof, including LF-normalized
source hashes and the eight unchanged historical composition hashes. Its
verification is exercised by tooling tests. Mutation/conservation/boundary tests
live in `packages/simulation/tests/finiteIo.test.ts` and
`scripts/tests/finite-io.test.ts`.

UI needs only: review page/buffer/device/source assumptions and workload identity;
show separate pool/CPU/lock/device/WAL populations and durations; distinguish
caller outcome from remote commit and post-ack work; display omitted background
interference, buffer reservation versus Unknown full RSS, Unknown totals and
unsupported physical/calibration claims. No UI design or implementation is added.
