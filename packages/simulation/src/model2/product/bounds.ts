// Compiler ingestion budgets are software limits, never capacity/performance defaults.
export const PRODUCT_LIMITS = { fields: 500000, depth: 32, text: 4096, nodes: 256, edges: 2048, slots: 128, controllerEvents: 10000 } as const;
export function boundedProduct(value: unknown) {
  const active = new Set<object>(); let fields = 0;
  const visit = (v: unknown, depth: number) => {
    if (++fields > PRODUCT_LIMITS.fields || depth > PRODUCT_LIMITS.depth) throw Error("Compiler input structural budget exceeded");
    if (typeof v === "number" && !Number.isFinite(v)) throw Error("Non-finite compiler number");
    if (typeof v === "string" && v.length > PRODUCT_LIMITS.text) throw Error("Compiler text budget exceeded");
    if (["bigint", "function", "symbol"].includes(typeof v)) throw Error("Compiler accepts JSON authored data only");
    if (v && typeof v === "object") { if (active.has(v)) throw Error("Cyclic compiler input"); active.add(v); const entries = Object.values(v); if (entries.length > PRODUCT_LIMITS.fields - fields) throw Error("Compiler collection budget exceeded"); for (const c of entries) visit(c, depth + 1); active.delete(v); }
  }; visit(value, 0);
}
