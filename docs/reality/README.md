# Reality Engine M2A

Model 1 remains the only active published physics. Model 2 is an internal foundation.
See [audit](audit.md), [resource depth](resource-depth.md), [architecture](model2.md)
and [research](research.md). The machine-readable [ledger](model1-ledger.json) is
checked by `bun run check:reality`; it is not shipped in the API or browser.

No schema migration, historical reinterpretation or Free Mode switch is part of M2A.

`bun run debug:model2` inspects the internal proof at selected phase boundaries with
units, queue/connection/CPU state and metric definitions. Add `--json` for the complete
captured input, provenance and evidence. This is a local diagnostic CLI; it creates
no account, database rows, service or frontend route.
