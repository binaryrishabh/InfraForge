import { http, API_URL } from "@/client/httpClient";
import { authClient } from "@/features/auth/sessionClient";

export type LoginMethod = { id: string; providerId: string; createdAt: string };
export type ActiveSession = { id: string; createdAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null; current: boolean };

const base = `${API_URL}/account/settings`;

// null means the deployment has method settings switched off (404).
export async function loginMethods(): Promise<LoginMethod[] | null> {
  try { return (await http.get<{ methods: LoginMethod[] }>(`${base}/methods`)).data.methods; }
  catch (error) { if ((error as { response?: { status?: number } }).response?.status === 404) return null; throw error; }
}
export async function unlinkMethod(accountId: string, password: string) {
  await http.post(`${base}/unlink`, { accountId, password });
}
export async function connectProvider(provider: "google" | "github") {
  const { error } = await authClient.linkSocial({ provider, callbackURL: `${window.location.origin}/settings` });
  if (error) throw new Error(error.message ?? "Linking could not be started");
}
export async function activeSessions(): Promise<ActiveSession[]> {
  const all: ActiveSession[] = [];
  let after: string | null = null;
  do {
    const page: { sessions: ActiveSession[]; next: string | null } =
      (await http.get(`${base}/sessions`, { params: after ? { after } : {} })).data;
    all.push(...page.sessions); after = page.next;
  } while (after);
  return all;
}
export async function revokeSession(sessionId: string) { await http.post(`${base}/sessions/revoke`, { sessionId }); }
export async function revokeOtherSessions() { await http.post(`${base}/sessions/revoke-others`, {}); }
export function deviceName(agent: string | null) {
  if (!agent) return "Unknown device";
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Browser";
  const os = /Windows/.test(agent) ? "Windows" : /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Mac OS/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}
