import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import type { AccountFeatures, AuthCapabilities } from "@infraforge/contracts/auth";
import { accountFeatures, requestPasswordReset, requestSignupProof } from "./accountClient";
import { API_URL } from "../../client/httpClient";
import { obtainTurnstileToken, type TurnstileAction } from "./turnstileToken";
import { CredentialError } from "./credentials";

export function useAccountFeatures() {
  const [features, setFeatures] = useState<AccountFeatures | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    accountFeatures().then(value => { if (active) setFeatures(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  return { features, failed };
}
// Configured social providers for the sign-in and sign-up pages (empty until loaded).
export function useAuthProviders() {
  const [providers, setProviders] = useState<string[]>([]);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`${API_URL}/auth/providers`, { signal: abort.signal, credentials: "include" })
      .then(async (response) => (response.ok ? (await response.json() as AuthCapabilities).providers : []))
      .then(setProviders).catch(() => {});
    return () => abort.abort();
  }, []);
  return providers;
}
export function useMailCooldown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!seconds) return;
    const timer = setTimeout(() => setSeconds(seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  return { seconds, start: () => setSeconds(60) };
}
export async function requestAccountMail(action: TurnstileAction, email: string, siteKey: string | null, origin: string) {
  const token = siteKey ? await obtainTurnstileToken(action) : undefined;
  const normalized = email.trim().toLowerCase();
  return action === "signup" ? requestSignupProof(normalized, `${origin}/signup`, token)
    : requestPasswordReset(normalized, `${origin}/reset-password`, token);
}
export function asCredentialError(error: unknown) {
  return isAxiosError(error) ? new CredentialError(error.response?.data?.code, error.response?.status) : error;
}
export function accountError(error: unknown) {
  const failure = asCredentialError(error);
  if (failure instanceof CredentialError && failure.status === 429) return "Too many attempts. Wait a moment before trying again.";
  if (failure instanceof CredentialError && failure.status === 403 || error instanceof Error && /security check/i.test(error.message)) return "Complete the security check and try again.";
  return "The request could not be completed. Try again later.";
}
