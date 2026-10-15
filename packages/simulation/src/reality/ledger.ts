import { validateQuantity, type Quantity } from "./quantity";

export const CLASSIFICATIONS = ["provider-fact", "protocol-fact", "user-input", "derived", "calibrated-model", "educational-assumption", "placeholder", "approximation", "unverified", "obsolete", "unknown", "implementation-policy"] as const;
export interface RealityEntry {
  id: string;
  concept: string;
  modelVersion: "1" | "2";
  scope: string;
  // Required by the M2B input contract; historical M1/M2A entries retain their schema.
  validityDomain?: string;
  quantity: Quantity;
  formula: string;
  classification: typeof CLASSIFICATIONS[number];
  confidence: "high" | "conditional" | "low" | "unknown";
  provenance: Array<{ source: string; supports: "exact" | "bound" | "qualitative" | "implementation"; detail: string }>;
  assumptions: string[];
  researchedOn: string;
  freeMode: "allowed" | "conditional" | "forbidden";
  replacement: string;
}

export function validateLedger(entries: RealityEntry[]): string[] {
  const errors: string[] = [], ids = new Set<string>();
  for (const e of entries) {
    const fail = (s: string) => errors.push(`${e.id}: ${s}`);
    if (!e.id || ids.has(e.id)) fail("Missing or duplicate stable id");
    ids.add(e.id);
    for (const field of [e.concept, e.scope, e.formula, e.replacement]) if (!field?.trim()) fail("Missing description/formula/replacement");
    if (e.validityDomain !== undefined && !e.validityDomain.trim()) fail("Empty validity domain");
    if (!CLASSIFICATIONS.includes(e.classification)) fail("Unsupported classification");
    if (!["1", "2"].includes(e.modelVersion)) fail("Unsupported model");
    if (!["high", "conditional", "low", "unknown"].includes(e.confidence)) fail("Missing confidence");
    if (!["allowed", "conditional", "forbidden"].includes(e.freeMode)) fail("Missing Free Mode policy");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.researchedOn)) fail("Missing research date");
    if (!e.provenance.length || e.provenance.some((p) => !p.source || !p.detail || !["exact", "bound", "qualitative", "implementation"].includes(p.supports))) fail("Missing provenance/support extent");
    if (!e.assumptions.length || e.assumptions.some((a) => !a.trim())) fail("Assumptions must be explicit");
    for (const error of validateQuantity(e.quantity)) fail(error);
    if (e.quantity.provenance.some((id) => id !== e.id && !entries.some((v) => v.id === id))) fail("Unresolved quantity provenance");
    if (["provider-fact", "protocol-fact"].includes(e.classification) && !e.provenance.some((p) => p.supports === (e.quantity.kind === "range" ? "bound" : "exact") && /^https:\/\//.test(p.source))) fail("A fact requires exact/bound external support");
    if (e.freeMode === "allowed" && ["educational-assumption", "placeholder", "unverified", "obsolete", "unknown"].includes(e.classification)) fail("Unsupported Free Mode certainty");
    if (e.classification === "calibrated-model" && !e.provenance.some((p) => p.supports === "exact")) fail("Calibration evidence missing");
  }
  return errors;
}
