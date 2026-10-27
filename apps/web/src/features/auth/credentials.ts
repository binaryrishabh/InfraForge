import { LOGIN_ERROR } from "@infraforge/contracts/auth";

export type CredentialFields = { username: string; email: string; password: string };
export type FieldErrors = Partial<Record<keyof CredentialFields | "identifier", string>>;
export function signupFailure(code?: string): FieldErrors & { message?: string } {
  if (code === "USERNAME_IS_ALREADY_TAKEN") return { username: "That username is unavailable. Choose another." };
  if (code === "INVALID_USERNAME" || code === "USERNAME_TOO_SHORT" || code === "USERNAME_TOO_LONG") return { username: "Use 3–30 letters, numbers or underscores, starting with a letter." };
  if (code === "INVALID_EMAIL") return { email: "Enter a valid email address." };
  if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG" || code === "PASSWORD_TOO_WEAK") return { password: "Meet every password rule below." };
  if (code === "PASSWORD_COMPROMISED") return { password: "This password appeared in a data breach. Choose another." };
  return { message: "An account could not be created with these details. If you have an account, sign in using your original method; otherwise try another username or email." };
}
export function credentialBody(identifier: string, password: string) {
  return { identifier: identifier.trim(), password };
}
export class CredentialError extends Error {
  constructor(readonly code?: string, readonly status?: number) { super(LOGIN_ERROR); }
}
// Sign-in failures: an unconfirmed email is actionable; everything else stays generic.
export function signinFailure(code?: string, status?: number): "unverified" | "rate" | "login" {
  if (status === 429) return "rate";
  return code === "EMAIL_NOT_VERIFIED" ? "unverified" : "login";
}
