import { validateLedger, type RealityEntry } from "../../reality/ledger";
import { type Quantity, type Unit, requireKnown } from "../../reality/quantity";
export function derivedLedger(authored: RealityEntry[]) {
  const errors = validateLedger(authored); if (errors.length) throw Error(errors.join("; "));
  const ledger = [...authored], ids = new Set(ledger.map((e) => e.id));
  const quantities = new Map(ledger.map((e) => [e.id, e.quantity]));
  function q<U extends Unit>(id: string, value: number, unit: U, sources: string[], classification: "derived" | "user-input" | "implementation-policy" = "derived"): Quantity<U> {
    if (ids.has(id) || !Number.isFinite(value) || !sources.length) throw Error("Compiler provenance identity/value/source invalid"); ids.add(id);
    const quantity: Quantity<U> = { kind: "known", value, unit, provenance: [id] };
    ledger.push({ id, concept: id, modelVersion: "2", scope: "Internal product compiler; no external physical validity inferred", validityDomain: "Only the authored design/application/infrastructure versions retained by this compile", quantity, formula: sources.join("; "), classification, confidence: "conditional", provenance: sources.map((source) => ({ source, supports: "implementation" as const, detail: "Exact authored value or deterministic compiler arithmetic; not an independently measured fact" })), assumptions: ["Synthetic profiles verify software; no Free Mode eligibility"], researchedOn: "2026-10-16", freeMode: "forbidden", replacement: "Versioned measured/provider contracts required before external physical claims" }); quantities.set(id, quantity); return quantity;
  }
  function audit(value: unknown, path = "input"): void {
    if (!value || typeof value !== "object") return;
    if ("kind" in value && "unit" in value && "provenance" in value) {
      const quantity = value as Quantity; requireKnown(quantity, quantity.unit);
      for (const id of quantity.provenance) { const row = quantities.get(id); if (!row || JSON.stringify(canonical(row)) !== JSON.stringify(canonical(quantity))) throw Error(`Missing exact compiler quantity ${path}: ${id}`); } return;
    }
    for (const [key, child] of Object.entries(value)) if (key !== "ledger") audit(child, `${path}.${key}`);
  }
  return { ledger, q, audit };
}
export function canonical<T>(value: T): T {
  if (Array.isArray(value)) return value.map(canonical) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)])) as T;
  return value;
}
