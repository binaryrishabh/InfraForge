/** Bounded educational single-name publication. Omission preserves the published baseline. */
export interface DnsPublication { version: 1; initialRecord: "absent" }
export function dnsPublicationError(type: string, value: unknown): string | null {
  if (value === undefined) return null;
  if (type !== "DNS" || !value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join() !== "initialRecord,version" ||
    (value as DnsPublication).version !== 1 || (value as DnsPublication).initialRecord !== "absent") return "DNS publication requires version 1 and initially absent record on DNS only.";
  return null;
}
