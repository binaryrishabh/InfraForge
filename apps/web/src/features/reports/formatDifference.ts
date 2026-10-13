export const comparisonValue = (v: number | null) => v === null ? "unknown" : v.toLocaleString(undefined, { maximumFractionDigits: 6 });
export function signedValue(v: number | null) { return v === null ? "withheld" : `${v > 0 ? "+" : ""}${comparisonValue(v)}`; }
