import type { DesignChangeReview } from "@infraforge/contracts/reports";

const FIELDS: Record<string, string> = { skuId: "catalog size", size: "generic size", type: "resource type", region: "region", public: "public access",
  encryption: "encryption", openPorts: "open ports", "autoscaling.enabled": "autoscaling", "autoscaling.minReplicas": "minimum replicas",
  "autoscaling.maxReplicas": "maximum replicas", "autoscaling.targetCpu": "target CPU" };
const value = (v: unknown): string => v == null ? "not set" : typeof v === "boolean" ? v ? "on" : "off" : Array.isArray(v) ? v.join(", ") || "none" : String(v);

export function DesignChangeSummary({ review }: { review: DesignChangeReview }) {
  const d = review.differences;
  if (!d) return <p className="text-sm">The starting design cannot be compared safely.</p>;
  return <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
    {d.added.map((id) => <li key={`add:${id}`}>{id} added</li>)}
    {d.removed.map((id) => <li key={`remove:${id}`}>{id} removed</li>)}
    {d.reconfigured.flatMap((r) => r.fields.map((f) => <li key={`${r.id}:${f.field}`}>{r.id} {FIELDS[f.field] ?? f.field}: {value(f.earlier)} → {value(f.later)}</li>))}
    {d.addedConnections.map((c) => <li key={`add:${c.sourceId}:${c.targetId}:${c.port}`}>Connection added: {c.sourceId} → {c.targetId}, port {c.port}</li>)}
    {d.removedConnections.map((c) => <li key={`remove:${c.sourceId}:${c.targetId}:${c.port}`}>Connection removed: {c.sourceId} → {c.targetId}, port {c.port}</li>)}
    {d.resourceOrder && !d.added.length && !d.removed.length && <li>Starting resource order changed: {d.resourceOrder.later.join(" → ")}. Model-1 random draws may shift.</li>}
    {d.connectionOrder && !d.addedConnections.length && !d.removedConnections.length && <li>Connection order changed.</li>}
  </ul>;
}
