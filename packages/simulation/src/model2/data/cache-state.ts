// Shared ownership primitives. Callers decide TTL policy, payload identity and service.
export function expireOwned<T extends { expires: number }>(entries: Map<string, T>, key: string, now: number, remove: (key: string) => void): boolean {
  const entry = entries.get(key); if (!entry || entry.expires > now) return false; remove(key); return true;
}
export function evictOwned<T>(entries: Map<string, T>, fits: () => boolean, remove: (key: string, entry: T) => void) {
  while (!fits() && entries.size) { const [key, entry] = entries.entries().next().value!; remove(key, entry); }
}
