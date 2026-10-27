// Shared validation is a UX contract. The auth server and database remain authoritative.
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export function passwordChecks(password: string): { id: "length" | "lower" | "upper" | "digit" | "symbol"; ok: boolean }[] {
  return [
    { id: "length", ok: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX },
    { id: "lower", ok: /[a-z]/.test(password) },
    { id: "upper", ok: /[A-Z]/.test(password) },
    { id: "digit", ok: /[0-9]/.test(password) },
    { id: "symbol", ok: /[^\p{L}\p{N}]/u.test(password) },
  ];
}
export const passwordAcceptable = (password: string) => passwordChecks(password).every(check => check.ok);
export const USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{2,29}$/;
export const normalizeUsername = (value: string) => value.trim().toLowerCase();
export const validUsername = (value: string) => USERNAME_PATTERN.test(value);
export const LOGIN_ERROR = "Username, email or password is incorrect.";
export interface AuthCapabilities { credentials: boolean; providers: string[] }
export const ACCOUNT_EXPORT_SECTIONS = ["designs", "runs", "actions", "samples", "internalRuns", "lessons", "firstStackRuns", "cuts", "results"] as const;
export type AccountExportSection = typeof ACCOUNT_EXPORT_SECTIONS[number];
export type AccountExportPage = { schema: "infraforge-account-export/1"; section: AccountExportSection;
  records: Record<string, unknown>[]; next: string | null };
export type AccountFeatures = { enabled: boolean; emailEnabled: boolean; verificationRequired: boolean; turnstileSiteKey: string | null };
