export function exactOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value || url.username || url.password ||
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Exact public HTTPS origin required");
  return value;
}
export function fullSha(value: string) {
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error("Full release SHA required");
  return value;
}
type Health = { success?: boolean; release?: { sha?: string; authContract?: number } };
export function checkBackend(sha: string, value: unknown, maintenance: string | null) {
  const health = value as Health | null;
  if (!health?.success || health.release?.sha !== fullSha(sha) || health.release.authContract !== 1 || maintenance !== "false") {
    throw new Error("Public backend identity/readiness/maintenance gate failed");
  }
}
export function checkFrontend(sha: string, backend: string, value: unknown) {
  const web = value as { sha?: string; authContract?: number; apiURL?: string; wsURL?: string } | null;
  exactOrigin(backend);
  if (web?.sha !== fullSha(sha) || web.authContract !== 1 || web.apiURL !== `${backend}/api` ||
      web.wsURL !== `${backend.replace(/^https:/, "wss:")}/ws`) throw new Error("Frontend release identity/endpoints gate failed");
}
export async function publicJSON(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: "error", cache: "no-store" });
  if (response.status !== 200) throw new Error("Public release endpoint did not return HTTP 200");
  return { response, body: await response.json() };
}
export async function verifyBackend(sha: string, origin: string) {
  exactOrigin(origin);
  const { response, body } = await publicJSON(`${origin}/health/ready`);
  checkBackend(sha, body, response.headers.get("X-InfraForge-Maintenance"));
  const providers = await publicJSON(`${origin}/api/auth/providers`);
  if ((providers.body as { credentials?: unknown } | null)?.credentials !== true || providers.response.headers.get("X-InfraForge-Maintenance") !== "false") {
    throw new Error("Public credential provider/maintenance check failed");
  }
}
if (import.meta.main) {
  const [sha = "", backend = ""] = process.argv.slice(2);
  await verifyBackend(sha, backend);
  console.log(`Public backend accepted ${fullSha(sha)}`);
}
