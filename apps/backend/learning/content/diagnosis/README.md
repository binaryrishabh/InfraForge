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
