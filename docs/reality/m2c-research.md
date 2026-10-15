# M2C compute research

Researched 2026-10-15. Primary sources support mechanisms and boundaries, not a
provider/application performance constant. M2B research remains applicable to
arrivals, identities, caller ownership, measurement error and held-out evaluation.

| Source | Decision / limit |
| --- | --- |
| Linux [CFS design](https://docs.kernel.org/scheduler/sched-design-CFS.html) and [EEVDF](https://docs.kernel.org/scheduler/sched-eevdf.html) | Real scheduling accounts execution and eligibility, rather than reserving a permanent slice for every configured worker. Use a deterministic fluid abstraction; do not reproduce Linux quanta or claim this is either kernel scheduler. |
| Linux [capacity-aware scheduling](https://docs.kernel.org/scheduler/sched-capacity.html) | CPU time, normalized execution capability and frequency are different concepts. Provider vCPU labels do not identify application performance. Heterogeneous cores, DVFS, interrupts and topology remain unmodeled. |
| Linux [CFS bandwidth](https://docs.kernel.org/scheduler/sched-bwc.html) | Quota is a replenished CPU-time budget, distinct from instantaneous parallel capacity. Implement a scoped fixed-period aggregate budget without Linux's hierarchy, local silos, burst carry or runtime slices. |
| Linux [cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html) | Weight distributes share among active contenders; bandwidth limits and memory high/max have distinct semantics. Keep equal per-invocation fluid sharing now, with an explicit versioned policy; no invented provider weights or universal cgroup emulator. |
| Linux [PSI](https://docs.kernel.org/accounting/psi.html) | Utilization is not pressure. Report runnable work, share deficit and throttling separately; do not label the fluid parallelism deficit as measured Linux PSI or OS scheduler delay. |
| Intel [processor technologies](https://www.intel.com/content/www/us/en/support/articles/000006513/processors.html) and [SMT](https://www.intel.com/content/www/us/en/gaming/resources/hyper-threading.html) | Logical contexts share physical resources. Turbo depends on operating conditions. These architectural cautions do not calibrate this AMD host or justify one logical processor = one perfect physical core. |
| USENIX [Elfen scheduling](https://www.usenix.org/conference/atc16/technical-sessions/presentation/yang) | Co-running SMT work can change interference and tail behavior. Do not insert one universal SMT/contention multiplier. Keep workload/configuration-specific measured points and visible errors. |
| Node [worker threads](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html) | Worker isolates enable CPU work in parallel but have startup, messaging and runtime costs. Application workers and execution capacity are independent. Worker `resourceLimits` do not establish a complete process/native-buffer memory limit. |
| Node [process measurements](https://nodejs.org/docs/latest-v24.x/api/process.html) | Process CPU aggregates scheduled CPU time; RSS covers the process while other memory fields in workers are thread-local. Do not sum worker RSS, or mistake aggregate CPU/wall for physical topology. |
| Node [synchronous PBKDF2](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptopbkdf2syncpassword-salt-iterations-keylen-digest) and [RFC 8018](https://www.rfc-editor.org/rfc/rfc8018) | The controlled operation uses one synchronous derivation in one application worker, with one SHA256 output block and sequential iteration dependencies. The scoped invocation parallelism is one; this is not a default for arbitrary native libraries or applications. |
| Linux [process status/RSS](https://man7.org/linux/man-pages/man5/proc_pid_status.5.html) and [getrusage](https://man7.org/linux/man-pages/man2/getrusage.2.html) | Resident, virtual, shared and peak memory measures differ; process CPU counters have scope/precision limits. A component allocation count is not a resident-page ownership census. |
| Microsoft [working sets](https://learn.microsoft.com/windows/win32/memory/working-set) | Residency changes through demand paging and working-set management; allocated or committed bytes are not automatically resident bytes. The model uses declared modeled resident components, not Windows working-set emulation. |
| Linux [overcommit](https://docs.kernel.org/mm/overcommit-accounting.html) and [memory management](https://docs.kernel.org/admin-guide/mm/index.html) | Allocation failure, reclaim, swapping and process killing require policy and state. M2C supports only explicit modeled allocation rejection; no guessed OOM target/death/recovery or global RAM percentage threshold. |
| V8 [concurrent marking](https://v8.dev/blog/concurrent-marking) | Runtime/GC work can be concurrent and memory release need not immediately reduce RSS. No synthetic GC-time or fragmentation counter is emitted. Retain resident mapping Unknown when the experiment cannot identify it. |
| USENIX [performance variability](https://www.usenix.org/conference/osdi18/presentation/maricq) and [warmup study](https://arxiv.org/abs/1602.00602) | Repetition/warmup do not eliminate frequency, host interference or stationarity concerns. Record the procedure and hold out configurations; no fabricated statistical confidence from a few adjacent runs. |

## Abstraction choice

Capped max-min equal processor sharing gives each runnable invocation an equal share
until its parallelism cap is reached, then redistributes unused capacity. It is
work-conserving subject to eligibility/caps, pause and explicit quota. Workers limit
admitted application concurrency; blocked workers remain occupied without being
runnable. This is an analytical, calibratable model, not physical task placement.
Under fluid sharing, many calls can receive fractional service simultaneously; that
does not mean the host physically executes that many threads at the same instant.

Explicit kernel quanta would add unmeasured context-switch/dispatch parameters and
event churn. Permanent cores/workers reservation wastes spare capacity. A generic
contention multiplier hides the mechanisms and was rejected. Weighted groups are
deferred until there are modeled groups and evidence for the policy; a future
scheduler revision can add weights without changing caller or memory ownership.

NUMA, affinity, cache misses, frequency scaling, power/thermal state, shared-page
deduplication, allocator fragmentation, reclaim, swap, OOM and GC were researched but
are not simulated. They can affect observed data without being identifiable causes
of a particular residual. CPU accounting units in the calibration experiments are
an explicit hypothesis; physical-core equivalence remains Unknown.

## Variation and calibration decision

Process CPU per completed operation changes across the measured worker counts and
even across repetitions. Wall service observations additionally include scheduling
and messaging effects. They cannot safely become an empirical CPU-demand distribution.
Keep service variance Unknown, record response populations and fit only conditional
means at discrete worker points. Reject silent interpolation at held-out worker counts.
The numerical transfer experiment is explicitly unsupported and never promoted.
