# First-stack browser runner (inactive)

`apps/web/src/firstStack/runner.ts` exports `runFirstStackInBrowser(request,
{ signal? })`, returning `{ result, cancel }`. The request contains an owner,
saved layout including its exact reviewed first-stack sidecar, resolved recording,
explicit seeded execution policy, and approved engine source/image identities.
The source must match `enginePin.json`; regenerate/check it with
`bun --no-env-file scripts/browser-first-stack/pin.ts --write` / without `--write`.
The generator invokes the existing full server identity check.

The engine runs only in a disposable module worker. One active worker per page,
4 MiB complete input, 5,000 roots, 250,000 events, 60,000,000 virtual microseconds,
15,000 ms wall time, finite kernel queues/live calls/retention, and a 1 MiB cut
bound execution. Cancellation and the page watchdog terminate the worker, even
when compilation cannot yield. The worker yields between bounded event slices.
It returns an isolated-cut/1 envelope using slice 11's compile lock, immutable
input hash and fingerprint fields, including slice 12's bounded report capture;
it does not export unbounded raw results. Capture saturation, selected journal
events, omission counts and the 256 KiB Unknown fallback match the current server.
Both paths export the same `captureReport` implementation from
`packages/simulation/src/firstStack/reportCapture.ts`. It also records fixed modeled
host occupancy through the cut, once per host regardless of shared roles or process
faults. The horizon is an observation boundary, not allocation termination.
Tariffs and compute subtotals are absent from execution cuts. Server report assembly
can apply a separate frozen tariff selection only to matching verified server usage;
missing usage, verification or an eligible selection leaves the subtotal Unknown.

128 MiB is an **observed heap** cutoff only when `performance.memory` exists.
CPU time, RSS and unavailable heap measurements are `Unknown`. Browsers provide
no portable hard worker heap quota; this is not an 8 GiB device qualification or
a guarantee against browser/OS failure under unrelated memory pressure. Logical
bounds and termination limit exposure. No physical timing calibration is claimed.

`createFirstStackSubmissionClient({ endpoint, owner, fetch? })` exports
`submit`, `read`, and `cancel`. Supply the future same-origin submission mount
explicitly. `submit` snapshots the run, checks owner/revision/pinned engine,
immutable input and bounded finished evidence, and sends slice 11's strict fields.
Authentication supplies the owner; the saved design supplies the design input;
policy includes the seed. No extra owner/input/seed wire fields are invented.
HTTP errors retain status and are never automatically retried. Browser evidence
remains untrusted; only the server verification result can establish verification.

Neither surface is imported by the shipped application, and the submission router
remains unmounted/default closed. Model 1 remains active. Integration requires an
explicit future activation decision.

## Reproduce

Use Bun 1.3.14 and the frozen application lockfile. Install test-only Playwright:

```powershell
npm install --prefix .cache/browser-tooling --no-save --package-lock=false playwright@1.64.1
node .cache/browser-tooling/node_modules/playwright/cli.js install chromium firefox webkit
bun --no-env-file scripts/browser-first-stack/pin.ts --write
bun --no-env-file scripts/browser-first-stack/oracle.ts --write
bun --no-env-file scripts/browser-first-stack/determinism.ts
node scripts/browser-first-stack/build.mjs
bun --no-env-file scripts/browser-first-stack/determinism.ts --worker --vite
bun --no-env-file --no-install test scripts/tests/browserRunner.test.ts scripts/tests/browserSubmission.test.ts scripts/tests/browserPin.test.ts scripts/tests/browserBoundary.test.ts scripts/tests/boundaries.test.ts
```

Linux browser installs require Playwright's `--with-deps`. CI reuses its external
Playwright installation through `MODEL2_BROWSER_MODULE`. The initial gate compares
18 full canonical results/journals/locks, canonical cuts and server fingerprints in Bun and real
Chromium/Firefox/WebKit. The worker check compares the emitted Vite worker's cuts
against the same server oracle, calls the server cut reader, checks page heartbeat,
cancellation, watchdog and wrong-engine handling in each browser. The server-only
`oracle.ts` generator writes `scripts/fixtures/browser-server-results.json` from
the current server runtime, `captureExecutionCut` and `cutFingerprint`; browser
output never supplies expected hashes. The harness checks these fixtures before
comparison. Complete cut bytes must match except for host-specific
`effectiveLimits` metadata, which the server excludes from its fingerprint.

## Future UI needs

- Explicit saved-design/reviewed-workload/seed selection and run/cancel controls.
- Local progress, interruption and unsupported-budget explanations; no silent truncation.
- Evidence labels, Unknown memory/CPU fields, incomplete-work censoring and local retention/export.
- Owner/session transitions that cancel local runs and discard stale submission actions.
- Explicit private/shared/scored submission, stable idempotency keys and polling/cancel controls.
- Distinct unverified/verified/mismatch/interrupted/unavailable/recovery states, with original local evidence retained.
- An 8 GiB physical-device stress qualification before any device-safety marketing claim.

No UI, styling, public route activation, queue startup, or Model 2 activation is included.
