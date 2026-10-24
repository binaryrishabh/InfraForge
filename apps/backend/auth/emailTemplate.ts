import type { TransactionalMessage } from "./email";

const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (value: string) => value.replace(/[&<>"']/g, c => escapes[c]!);
export function accountEmail(
  to: string, url: string, kind: "verify" | "reset" | "signup", firstParty: string | string[],
): TransactionalMessage {
  const link = new URL(url);
  const origins = (Array.isArray(firstParty) ? firstParty : [firstParty]).map(value => new URL(value).origin);
  const firstPartyLink = origins.includes(link.origin) && ["http:", "https:"].includes(link.protocol);
  if (!firstPartyLink || link.username || link.password) {
    throw Error("Invalid account email link");
  }
  const title = kind === "reset" ? "Reset your InfraForge password"
    : kind === "signup" ? "Continue your InfraForge signup" : "Verify your InfraForge email";
  const expiry = "This link expires in 30 minutes and can be used once.";
  const unsolicited = "If you did not request it, ignore this email.";
  return { to, subject: title, ...(kind === "reset" ? { sensitive: true } : {}),
    text: `${title}. ${expiry} ${unsolicited}\n\n${url}`,
    html: [
      '<!doctype html><html lang="en"><head><meta charset="utf-8">',
      `<title>${title}</title></head><body><h1>${title}</h1>`,
      `<p>${expiry}</p><p><a href="${escape(url)}">${title}</a></p>`,
      `<p>${unsolicited}</p></body></html>`,
    ].join(""),
  };
}
