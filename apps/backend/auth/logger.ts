import type { Logger } from "@better-auth/core/env";
import { BASE_ERROR_CODES } from "@better-auth/core/error";

// Emit fixed diagnostics only: arbitrary error prose can contain even unlabelled
// usernames, request bodies, emails, cookies or short credentials. Discarding the
// rest also strips email-like strings and long tokens without guessing their form.
const reasons = [
  ...Object.values(BASE_ERROR_CODES).flatMap(error => [error.code, error.message, error.code.toLowerCase()]),
  "account_not_linked", "state_not_found", "state_mismatch", "state_security_mismatch", "state_expired",
  "invalid_callback_request", "internal_server_error", "INVALID_CALLBACK_REQUEST", "INTERNAL_SERVER_ERROR",
  "State not found", "Failed to parse state", "Failed to create verification", "Invalid origin",
  "Invalid callbackURL", "Invalid redirectURL", "OAuth issuer mismatch", "Unable to get user info",
  "Failed to create user", "Failed to create session", "Failed to read session from database",
  "Failed to delete session from database", "Better auth was unable to query your database.",
  "Connection terminated unexpectedly", "Connection terminated", "Connection refused",
  "connect ECONNREFUSED", "Query read timeout", "timeout exceeded when trying to connect",
  "PrismaClientKnownRequestError", "PrismaClientInitializationError",
].sort((a, b) => b.length - a.length);
const classes = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "APIError", "BetterAuthError",
  "StateError", "DatabaseError", "OAuth2RequestError", "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError", "PrismaClientInitializationError", "PrismaClientValidationError"]);

function safeReason(value: unknown) {
  if (typeof value !== "string") return;
  // Match only a diagnostic prefix and emit our constant, never the supplied text.
  return reasons.find(reason => value === reason || value.startsWith(reason)
    && /^[\s:.,;(\[]/.test(value.slice(reason.length, reason.length + 1)));
}

export const authLogger: Logger = { level: "error", log(level, message, ...args: unknown[]) {
  const diagnostics: string[] = [], names = new Set<string>();
  for (const value of [message, ...args.slice(0, 4)]) {
    if (value instanceof Error) {
      const error = value as Error & { code?: unknown; body?: { code?: unknown; message?: unknown } };
      const name = error.name;
      names.add(classes.has(name) ? name : "Error");
      for (const text of [error.code, error.body?.code, error.message, error.body?.message]) {
        const reason = safeReason(text);
        if (reason) diagnostics.push(reason);
      }
    } else {
      const reason = safeReason(value);
      if (reason) diagnostics.push(reason);
    }
  }
  console.error("Authentication operation failed", {
    level, reason: [...new Set(diagnostics)].slice(0, 3).join("; ").slice(0, 400) || "Unknown auth error",
    errorClass: [...names].slice(0, 2).join(", ") || "Unknown",
  });
} };
