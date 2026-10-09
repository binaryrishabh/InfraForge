export function webRelease(env: Record<string, string | undefined>) {
  const controlled = env.VERCEL_ENV === "production" || env.RELEASE_BUILD === "1";
  const sha = env.RELEASE_SHA || env.VERCEL_GIT_COMMIT_SHA || "development";
  if (controlled) {
    if (env.RELEASE_SHA && env.VERCEL_GIT_COMMIT_SHA && env.RELEASE_SHA !== env.VERCEL_GIT_COMMIT_SHA) throw new Error("Frontend Git and release identities disagree");
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Production frontend requires an exact release SHA");
    const api = new URL(env.VITE_BACKEND_API_URL || "");
    const ws = new URL(env.VITE_WS_URL || "");
    if (api.protocol !== "https:" || ws.protocol !== "wss:" || api.hostname !== ws.hostname || api.port !== ws.port ||
        api.pathname !== "/api" || ws.pathname !== "/ws" || api.username || api.password || ws.username || ws.password ||
        api.search || api.hash || ws.search || ws.hash || ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname)) {
      throw new Error("Production requires HTTPS /api and WSS /ws on the same public API hostname");
    }
  }
  return { sha, authContract: 1, apiURL: env.VITE_BACKEND_API_URL || "http://localhost:3000/api", wsURL: env.VITE_WS_URL || "ws://localhost:3001" };
}
