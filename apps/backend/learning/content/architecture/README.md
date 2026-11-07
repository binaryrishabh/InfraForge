# Architecture choices

The original `cross-resource-choices` module keeps its three intermediate labs.
The advanced `capacity-budgets` module adds `split-the-capacity-budget@1`.
It combines two serial CPU constraints and a binding catalog-only budget. It does
not repeat the read-only cache/database choice or the VM-crash pool exercise.

The new lab uses a direct app-to-database path and explicit catalog SKUs on both
resources. The designer's **Instance size** section, **Provider** selector and
DigitalOcean options are the only edits taught. Generic load-balancer and cache
fallback costs are deliberately absent. Snapshot prices are not quotes; model
capacity and service demands are educational assumptions.

Review scope for lesson contentVersion 1: requirements, default mixed workload,
existing prerequisites, hints, prediction evidence, report labels and limitations
were checked against the pinned new definition and real-engine calibration.
The identity is recorded in `learning/reviewedChallenges.ts`; authoring tests refuse
a missing or changed identity. Earlier published lessons, definitions and pins
remain unchanged.

`capacityBudgetCalibration.test.ts` controls each tier change, measures starter and
partial failures, three passing allocations, an under-capacity near miss and a
design that fails only budget. `capacityBudgetReplay.test.ts` compares the browser
bundle with server replay at every tick. The web report test renders actual engine
reports through the shared measurement and requirement components.

Lesson contentVersion 2 updates the cost guidance and limitations for the saved
report. The original v1 source and review remain unchanged and registered as an
archive; the v2 review uses the same pinned challenge definition. Current lists
show v2, while explicit v1 lookup still returns its original text.

Budget audit: the saved report renders **Monthly estimate (CostEstimate gate)**,
retained resource price line items, the exact challenge limit and signed remaining
budget. Prices come from the stored gate, without a current catalog lookup.
Absent or malformed breakdowns stay Unknown without changing the recorded total
or judge. Remaining budget is Unknown when a usable unique completed cost gate
or judged budget evidence is absent. A negative amount is over budget.

The immutable challenge v1 debrief and archived lesson v1 still describe the old
report gap. They are historical authored text, not the current report capability;
their pins and text were preserved. No maximum supported rate, continuous health,
whole-run latency SLO, failure tolerance or production bill is established.
