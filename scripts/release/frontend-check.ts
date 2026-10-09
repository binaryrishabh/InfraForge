const [sha, frontend, backend] = process.argv.slice(2);
if (!sha || !/^[a-f0-9]{40}$/.test(sha) || !frontend || !backend) throw new Error("Use <full-sha> <staged-frontend-origin> <backend-origin>");
for (const value of [frontend, backend]) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value || url.username || url.password) throw new Error("Exact HTTPS origins required");
}
const [web, api] = await Promise.all([fetch(`${frontend}/release.json`, { signal: AbortSignal.timeout(10000), redirect: "error" }),
  fetch(`${backend}/health/ready`, { signal: AbortSignal.timeout(10000), redirect: "error" })]);
const webRelease = await web.json() as { sha?: string; authContract?: number; apiURL?: string; wsURL?: string } | null;
const apiHealth = await api.json() as { success?: boolean; release?: { sha?: string; authContract?: number } } | null;
if (!web.ok || !api.ok || !apiHealth?.success || webRelease?.sha !== sha || apiHealth.release?.sha !== sha ||
    webRelease.authContract !== 1 || apiHealth.release.authContract !== 1 || webRelease.apiURL !== `${backend}/api` ||
    webRelease.wsURL !== `${backend.replace(/^https:/, "wss:")}/ws`) throw new Error("Frontend/backend release gate failed; do not promote the staged deployment");
console.log(`Frontend/backend ${sha} matched. Perform real OAuth and authenticated WS smoke tests before owner promotion.`);
