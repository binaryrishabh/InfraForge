// Shared validation is a UX contract. The auth server and database remain authoritative.
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 128;
export const USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{2,29}$/;
export const normalizeUsername = (value: string) => value.trim().toLowerCase();
export const validUsername = (value: string) => USERNAME_PATTERN.test(value);
export const LOGIN_ERROR = "Username, email or password is incorrect.";
export interface AuthCapabilities { credentials: boolean; providers: string[] }
export const ACCOUNT_EXPORT_SECTIONS = ["designs", "runs", "actions", "samples", "internalRuns", "lessons", "firstStackRuns", "cuts", "results"] as const;
export type AccountExportSection = typeof ACCOUNT_EXPORT_SECTIONS[number];
export type AccountExportPage = { schema: "infraforge-account-export/1"; section: AccountExportSection;
  records: Record<string, unknown>[]; next: string | null };
export type AccountFeatures = { enabled: boolean; turnstileSiteKey: string | null };
