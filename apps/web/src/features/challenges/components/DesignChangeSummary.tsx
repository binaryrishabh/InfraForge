import type { DesignChangeReview } from "@infraforge/contracts/reports";

const FIELDS: Record<string, string> = { skuId: "catalog size", size: "generic size", type: "resource type", region: "region", public: "public access",
  retry: "retry policy", encryption: "encryption", openPorts: "open ports", "autoscaling.enabled": "autoscaling", "autoscaling.minReplicas": "minimum replicas",
  "autoscaling.maxReplicas": "maximum replicas", "autoscaling.targetCpu": "target CPU" };
const value = (v: unknown, field?: string): string => {
  if (v == null) return "not set";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (Array.isArray(v)) return v.join(", ") || "none";
  if (typeof v === "object") {
    const p = v as Record<string, unknown>;
    if (field === "retry") return `${value(p.enabled)}; ${value(p.maxAttempts)} total attempts; backoff ${value(p.backoffMs)} ms; jitter ${value(p.jitterRatio)}; concurrent retry limit ${value(p.maxConcurrentRetries)}; failures ${value(p.retryOn)}`;
    return JSON.stringify(v);
  }
  return String(v);
};

export function DesignChangeSummary({ review }: { review: DesignChangeReview }) {
  const d = review.differences;
  if (!d) return <p className="text-sm">The starting design cannot be compared safely.</p>;
  return <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
    {d.added.map((id) => <li key={`add:${id}`}>{id} added</li>)}
    {d.removed.map((id) => <li key={`remove:${id}`}>{id} removed</li>)}
    {d.reconfigured.flatMap((r) => r.fields.map((f) => <li key={`${r.id}:${f.field}`}>{r.id} {FIELDS[f.field] ?? f.field}: {value(f.earlier, f.field)} → {value(f.later, f.field)}</li>))}
    {d.addedConnections.map((c) => <li key={`add:${c.sourceId}:${c.targetId}:${c.port}`}>Connection added: {c.sourceId} → {c.targetId}, port {c.port}</li>)}
    {d.removedConnections.map((c) => <li key={`remove:${c.sourceId}:${c.targetId}:${c.port}`}>Connection removed: {c.sourceId} → {c.targetId}, port {c.port}</li>)}
    {d.resourceOrder && !d.added.length && !d.removed.length && <li>Starting resource order changed: {d.resourceOrder.later.join(" → ")}. Model-1 random draws may shift.</li>}
    {d.connectionOrder && !d.addedConnections.length && !d.removedConnections.length && <li>Connection order changed.</li>}
  </ul>;
}
