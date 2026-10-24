// Only the exact Compose service is trusted without TLS in production. RFC1918
// addresses, localhost and arbitrary internal DNS names are not that service.
export function postgresUrl(value: string | undefined, session = false) {
  let url: URL;
  try { url = new URL(value ?? ""); } catch { throw new Error("An explicit PostgreSQL URL is required"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username ||
      url.pathname.length < 2 || url.hash || /[\s/%\\]/.test(url.hostname) || url.port === "0") {
    throw new Error("Production database endpoint is invalid");
  }
  if (session && (/-pooler\./i.test(url.hostname) || url.searchParams.get("pgbouncer") === "true" ||
      url.searchParams.has("pool_mode"))) throw new Error("Session-preserving endpoint required; transaction pooling is unsupported");
  const local = url.hostname === "postgres" && (!url.port || url.port === "5432");
  if (!local && url.searchParams.get("sslmode") !== "verify-full") throw new Error("Remote PostgreSQL requires sslmode=verify-full");
  const seen = new Set<string>();
  for (const [key, option] of url.searchParams) {
    if (seen.has(key)) throw new Error("Duplicate database options make the target ambiguous");
    seen.add(key);
    if (!(key === "sslmode" && (option === "verify-full" || local && option === "disable")) &&
        !(key === "channel_binding" && option === "require")) {
      throw new Error("Unsupported database options could redirect the target or weaken TLS");
    }
  }
  return url;
}
