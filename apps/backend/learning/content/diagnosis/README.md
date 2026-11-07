# Diagnosis exercises

`diagnose-query-admission@1` starts with a degraded design. A one-query execution
gate leaves the database Healthy with spare CPU, while admitted queries occupy
sessions and work queues upstream. The controlled fix changes only Active queries
to four. Enlarging the database instance alone leaves the gate and caller failures
unchanged. This differs from the existing CPU saturation, firewall admission,
retry mitigation and architecture comparison labs.

Cause -> report evidence -> fix:
- Explicit query gate -> Serving queries; Queued queries; CPU; Refused session opens;
  p95; Whole run: Failed -> raise only db Active queries from one to four.

The queued-query label audits the existing saved database reading. No report UI,
engine behavior, criterion kind, attempt history or diagnosis judge is added.
The existing prediction checks health and busiest type, not free-text reasoning.
Caller criteria do not establish application data correctness. The lesson's
controlled comparison keeps the original app and database dependency fixed;
arbitrary redesigns are outside that causal comparison.

Not added:
- Cache expiry stampede: cache counters are live-only, and the saved report does
  not render them. A low database CPU sample alone cannot prove coalescing or expiry.
- Worker outage backlog: the scenario compiler requires an offered-operation
  serving path; a background consumer outage is refused. That guard is unchanged.
- Retry amplification diagnosis: existing slowdown, pool reset and retry labs
  already cover this mechanism; another such lab would duplicate their teaching.
- Hot physical partition: the model has keyed rows and locks, not a physical
  partition model or a supported partition-rebalancing fix. No such claim is made.

Calibration/report/refusal tests live in `tests/diagnosisLabsCalibration.test.ts`;
browser-target/server replay parity includes starter, reference and wrong fix in
`tests/diagnosisLabsReplay.test.ts`. Hidden reference inputs remain test-only.

## Async and dependency diagnosis

`diagnose-consumer-credit@1` uses the permitted slow-consumer alternative. A worker
has enough CPU and an adequate visibility timeout, but its single prefetch credit
remains held during the authored acknowledgement delay. This differs from reducing
CPU work (`keep-up-with-the-queue`), repairing expired leases
(`leave-time-to-acknowledge`), poison redelivery, finite burst storage and scheduler
overlap. Run unchanged and record a diagnosis before changing only prefetch credit.
The server scores retained queue work and overall-health prediction, not prose.

| Cause | Existing saved evidence labels | One-change fix |
| --- | --- | --- |
| Credit held until acknowledgement limits receiving | Queue: originals; Queue: deliveries; Queue: completed object effects; Queue: acknowledged; Queue: ready; Queue: in flight; CPU; Whole run: Completed | Worker Prefetch credit 1 -> 16; keep Jobs in parallel, CPU work, acknowledgement delay and queue settings fixed |
| Wrong hypothesis: visibility expires too soon | Queue: redeliveries stays zero; Queue: acknowledged and Queue: ready remain unchanged with the longer lease | Visibility 30 -> 60 is a tested near miss, not the fix |

Tests compare actual starter, reference, longer-visibility and larger-buffer runs.
The reference increases acknowledgements while leaving producer outcomes unchanged.
`consumerDiagnosisCalibration.test.ts` covers saved reports and missing evidence;
`consumerDiagnosisReplay.test.ts` checks browser/server parity, actual broker credit,
ack-wait phases, growing ready depth and live message age. Reference designs live
only in the existing test harness. No new criterion or report label is introduced.

Gaps and not proven:
- `vm-crash` requires a primary compute role; the async worker is a different
  mechanism. The existing `consumer-outage` action also fails the challenge's
  offered-operation serving-path guard. Both refusals are tested and unchanged.
  This lab models steady slow consumption, not a timed crash or recovery.
- Oldest ready age is visible on the live queue panel but not in the saved
  requirement details or measurement renderer. The terminal snapshot can retain
  the live async block; retention alone does not make an audited report label.
  No ready message means Unknown age, not zero. No saved age/history claim is made.
- Direct worker-slot holding times and per-path connection-pool waiting have no
  audited saved labels. The optional second runnable lab is dropped rather than
  duplicating existing worker-slot, database CPU or retry mechanisms.
  `locate-the-missing-wait` teaches those distinct hypotheses conceptually.
- Neither lab requirements nor live diagnostics prove exact drain time, continuous
  health, availability, ordering, exactly-once effects or physical durability.
