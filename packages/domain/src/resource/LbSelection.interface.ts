/** Optional routing choice owned by a Load Balancer. */
export interface LbSelection { version: 1; policy: "round-robin" | "least-outstanding" }

export function lbSelectionError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Load Balancer") return "Selection policy belongs to a Load Balancer.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Load balancer selection requires an explicit version and policy.";
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !["round-robin", "least-outstanding"].includes(v.policy as string)) return "Load balancer selection requires version 1 and round-robin or least-outstanding.";
  if (Object.keys(v).some(k => !["version", "policy"].includes(k))) return "Load balancer selection contains unsupported settings.";
}
