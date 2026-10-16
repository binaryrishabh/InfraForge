import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { verifyConnectedProof } from "./verify-connected-proof";
import { contentHash } from "../apps/backend/internalModel2/identity";
const path = process.argv[2]; if (!path || process.argv.length !== 3) throw Error("Supply one connected proof");
const proof = JSON.parse(readFileSync(path, "utf8")); verifyConnectedProof(proof);
const rehash = (e: any) => { const { fingerprint: _old, ...body } = e; e.fingerprint = contentHash(body); };
const mutations: Record<string, (p: any) => void> = {
  "failed producer": p => { p.success = false; }, "missing case": p => { p.cases.shift(); }, "source drift": p => { p.source = "0".repeat(64); },
  "cross-version evidence": p => { p.runs[0].row.evidence.schema = "infraforge-internal-evidence/1"; rehash(p.runs[0].row.evidence); },
  "missing identity": p => { const e = p.runs[0].row.evidence; e.model.causal.identities = []; rehash(e); },
  "invented commit": p => { const e = p.runs.find((r: any) => r.name === "early-cancel").row.evidence; e.model.database[0].rows[0].version = 2; rehash(e); },
  "overflow claims certainty": p => { const e = p.runs.find((r: any) => r.name === "overflow").row.evidence; e.completeness.exactCausality = true; rehash(e); },
  "incomplete prefix relabelled complete": p => { p.runs.find((r: any) => r.name === "worker-prefix").row.status = "completed"; },
  "changed caller outcome": p => { const e = p.runs[0].row.evidence; e.model.callers.results[0].outcome = "rejected"; rehash(e); }
};
for (const change of Object.values(mutations)) { const changed = structuredClone(proof); change(changed); assert.throws(() => verifyConnectedProof(changed)); }
console.info(JSON.stringify({ refused: Object.keys(mutations), mutations: Object.keys(mutations).length }));
