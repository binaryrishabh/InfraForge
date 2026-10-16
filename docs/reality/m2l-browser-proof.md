# M2L real browser proof provenance

Producer: `466f5d77ba554415f6936e47e7d45cd2d40dd4fe`,
[CI run 38932531599](https://github.com/binaryrishabh/InfraForge/actions/runs/38932531599),
integration job `117079825301`. All ten jobs passed, including full workspace tests,
tooling, challenge hashes, audit, types, lint, boundaries, web build and the full
container packaging/release rehearsal. The full integration suite passed 19 tests
with 1,545 assertions; the browser journey ran inside its real deployment lifecycle.

The `internal-model2-browser-proof` artifact (ID `12060530081`) contains actual
Chromium `156.0.8078.4` screenshots and JSON. The browser used the actual Vite app
with Node, Better Auth sessions and saved-design API against the disposable
PostgreSQL 18 / Redis 8 services and actual Outbox/worker. It did not mock API
responses or execution results. One route deliberately committed the real POST
and discarded its response to test uncertain-admission recovery. Historical
corruption/source-change fixtures used privileged disposable SQL and restored
the owned record. There is no application failure-injection switch.

[Retained JSON](m2l-browser-proof.json) is exactly 670,377 bytes, SHA-256
`1b10ed6375a14a9c8aa76e4e3c5ae41593ecc9b2bc600aa266730cbd61712376`.
Workspace digest:
`19bea478db5f2c158a67765d602d4c129766dc78b32c101ad06c83e54318fce7`.
The M2K execution digest remains
`bac35c995b5e5d59a9ce901745c014644fdb843183adbcbb761fb99184c11306`.
These are distinct versioned boundaries; the GUI does not alter execution identity.

The real GUI-admitted completed run `2cd0be57-c208-4da9-92cc-5b98b526c884`
retained 19 captures through 40,000 us and three completed put/get/delete commands.
Input fingerprint:
`2bec857cd9ea454b0239a8ab01430928f15ee4dbe95539c6a1a315b144a8c37c`.
Capture fingerprint:
`e1391590ef26a368e2fb0d1776b5e5baad86332f269630d42a8327390a85db41`.
Modeled object byte-time is `671976 byte-us`; 24 authored bytes were created and
released, with zero current bytes after deletion. This is logical simulation
evidence, not physical storage durability, cloud throughput or provider billing.
Read-only deterministic replay matches the complete retained capture.

The same artifact preserves a worker-death interruption at capture 3 / 5,000 us,
a running cancellation at capture 5 / 10,000 us, and a queued cancellation at capture
0 with no evidence. Partial replays match only their committed prefixes. Missing
work is not zero and crashed runs are not resumed. Owned run/grant fixtures and
browser/server processes were cleaned up; the full integration teardown also
passed its fixture/session cleanup checks.

The 22 asserted browser/API cases cover read-only validation; stale revision;
authoritative compiler refusal; anonymous and cross-owner validation refusal;
review/back/edit and saved/history refresh; mobile authoring; missing grant;
legacy saved-field refusal; labelled server field errors; keyboard consent/execute;
lost POST response, reload and duplicate click with exactly one run; queued and
running cancellation; real author/review/worker/report journey; deterministic GUI
replay; worker-absent prefix and subsequent interrupted report; corrupt evidence;
historical source mismatch with readable history and disabled replay; mobile page
overflow/navigation clipping checks; two browser owner isolation; grant revocation;
and lost session. Desktop/mobile report, facts, Unknowns and review screenshots
were visually inspected. The fixed mobile navigation retains one readable line in
the existing horizontal navigation scroller.

Reconstruct locally without a database:

```sh
bun --no-env-file scripts/verify-model2-workspace-proof.ts docs/reality/m2l-browser-proof.json
bun --no-env-file scripts/m2l-inventory.ts
```

The verifier checks producer/schema/source, required cases, content identities,
actual input/capture bounds, historical reports and deterministic complete/prefix
replays. CI verifies both freshly produced and retained browser evidence. CI
screenshots expire after the configured 14-day artifact retention; the JSON above
is permanently retained. This proves only the narrowly authored internal journey.
Model 1 remains ACTIVE, Model 2 INTERNAL, production PARKED; independent Lead
acceptance of M2L is still required. Vercel is separate from Actions and failed on
the producer commit; no Vercel or production repair was attempted.
