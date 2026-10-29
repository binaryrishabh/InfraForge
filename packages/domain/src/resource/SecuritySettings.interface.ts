/** Educational TCP admission intent. Absence retains inferred listeners/policies. */
export interface ListenerSettings { version: 1; ports: number[] }
export interface FirewallSettings {
  version: 1; default: "allow" | "deny";
  rules: Array<{ id: string; priority: number; direction: "ingress" | "egress"; source: string; destination: string; fromPort: number; toPort: number; action: "allow" | "deny" }>;
}
export const SECURITY_SETTINGS_LIMITS = { ports: 32, rules: 32 } as const;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const port = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= 65535;
export function securitySettingsError(type: string, listeners: unknown, firewall: unknown, resources?: readonly { id: string; type: string }[]): string | undefined {
  if (listeners !== undefined) {
    if (type === "Firewall") return "A Firewall has no TCP listener; attach its policy to a service";
    if (!object(listeners) || listeners.version !== 1 || Object.keys(listeners).some(k => !["version", "ports"].includes(k))) return "Listener settings require version 1 and ports";
    if (!Array.isArray(listeners.ports) || listeners.ports.length > SECURITY_SETTINGS_LIMITS.ports || listeners.ports.some(p => !port(p)) || new Set(listeners.ports).size !== listeners.ports.length) return "Listener ports must be unique integers from 1 to 65535, at most 32 ports; empty means no listener";
  }
  if (firewall !== undefined) {
    if (type !== "Firewall") return "Firewall settings belong only to a Firewall";
    if (!object(firewall) || firewall.version !== 1 || !["allow", "deny"].includes(firewall.default as string) || Object.keys(firewall).some(k => !["version", "default", "rules"].includes(k))) return "Firewall settings require version 1 and default allow or deny";
    if (!Array.isArray(firewall.rules) || firewall.rules.length > SECURITY_SETTINGS_LIMITS.rules) return "Firewall policy supports at most 32 rules";
    const ids = new Set<string>();
    for (const r of firewall.rules) {
      if (!object(r) || Object.keys(r).some(k => !["id", "priority", "direction", "source", "destination", "fromPort", "toPort", "action"].includes(k))) return "Invalid firewall rule fields";
      if (typeof r.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(r.id) || ids.has(r.id)) return "Firewall rule IDs must be unique, 1 to 64 letters, digits, dashes or underscores";
      ids.add(r.id);
      if (!Number.isSafeInteger(r.priority) || (r.priority as number) < 0 || (r.priority as number) > 65535) return `Rule ${r.id}: priority must be an integer from 0 to 65535`;
      if (!["ingress", "egress"].includes(r.direction as string) || !["allow", "deny"].includes(r.action as string)) return `Rule ${r.id}: choose ingress or egress and allow or deny`;
      if (!port(r.fromPort) || !port(r.toPort) || r.fromPort > r.toPort) return `Rule ${r.id}: port range must be ordered integers from 1 to 65535`;
      for (const key of ["source", "destination"] as const) {
        const scope = r[key];
        if (typeof scope !== "string" || (scope !== "any" && (!/^[a-zA-Z0-9_-]{1,64}$/.test(scope) || (resources && !resources.some(n => n.id === scope && n.type !== "Firewall"))))) return `Rule ${r.id}: ${key} must be any or an existing service resource ID`;
      }
    }
  }
}
