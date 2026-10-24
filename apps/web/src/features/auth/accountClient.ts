import { API_URL, http } from "../../client/httpClient";
import { ACCOUNT_EXPORT_SECTIONS, type AccountExportSection, type AccountExportPage, type AccountFeatures } from "@infraforge/contracts/auth";

export async function accountFeatures(): Promise<AccountFeatures> {
  return (await http.get<AccountFeatures>(`${API_URL}/auth/account-features`)).data;
}
export async function requestPasswordReset(email: string, redirectTo: string, turnstileToken?: string): Promise<{ status: true; message: string }> {
  return (await http.post(`${API_URL}/auth/request-password-reset`, { email, redirectTo, turnstileToken })).data;
}
export async function sendVerificationEmail(email: string, callbackURL: string): Promise<{ status: true; message: string }> {
  return (await http.post(`${API_URL}/auth/send-verification-email`, { email, callbackURL })).data;
}
export async function verifyEmail(token: string): Promise<{ status: boolean }> {
  return (await http.get(`${API_URL}/auth/verify-email`, { params: { token } })).data;
}
export async function resetPassword(token: string, newPassword: string): Promise<{ status: boolean }> {
  return (await http.post(`${API_URL}/auth/reset-password`, { token, newPassword })).data;
}
// Email-enabled signup first proves mailbox control, then chooses credentials.
// Keep the proof only in memory; the UI must remove it from the address bar.
export async function requestSignupProof(email: string, callbackURL: string, turnstileToken?: string) {
  return (await http.post<{ status: true; message: string }>(`${API_URL}/auth/sign-up/email`, {
    email, callbackURL, turnstileToken,
  })).data;
}
export async function completeEmailSignup(input: {
  emailProof: string; email: string; username: string; name: string; password: string;
}) {
  return (await http.post(`${API_URL}/auth/sign-up/email`, input)).data;
}
export async function signupWithChallenge(input: { username: string; name: string; email: string; password: string; callbackURL?: string; turnstileToken?: string }): Promise<{ status: true; message: string } | { user: { id: string; email: string; name: string }; token: string | null }> {
  return (await http.post(`${API_URL}/auth/sign-up/email`, input)).data;
}
export async function deleteAccount(password: string, confirmation: "DELETE"): Promise<{ success: true }> {
  return (await http.post(`${API_URL}/account/delete`, { password, confirmation })).data;
}
export async function accountExportPage(section: AccountExportSection, after?: string, signal?: AbortSignal): Promise<AccountExportPage> {
  return (await http.get<AccountExportPage>(`${API_URL}/account/export`, { params: { section, after }, signal })).data;
}
// Yield pages so a future download UI can stream to a file without holding all
// run history in memory. No passwords, tokens or export data enter localStorage.
export async function* accountExport(signal?: AbortSignal): AsyncGenerator<AccountExportPage> {
  for (const section of ACCOUNT_EXPORT_SECTIONS) {
    let after: string | undefined;
    do {
      const page = await accountExportPage(section, after, signal);
      yield page;
      after = page.next ?? undefined;
    } while (after);
  }
}
