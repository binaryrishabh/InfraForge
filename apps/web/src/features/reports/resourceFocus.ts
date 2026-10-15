export const measurementId = (id: string, narrow = false) => `recorded-resource-${encodeURIComponent(id)}-${narrow ? "narrow" : "wide"}`;
export function focusMeasurement(id: string) {
  const target = [measurementId(id), measurementId(id, true)].map((key) => document.getElementById(key)).find((el) => el && el.getClientRects().length > 0)
    ?? document.getElementById("recorded-experiment-window");
  target?.focus(); target?.scrollIntoView({ block: "center" });
}
