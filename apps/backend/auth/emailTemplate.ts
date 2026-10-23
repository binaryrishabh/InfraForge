import type { TransactionalMessage } from "./email";

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function accountEmail(to: string, url: string, kind: "verify" | "reset", baseURL: string): TransactionalMessage {
  const link = new URL(url);
  if (link.origin !== new URL(baseURL).origin || link.username || link.password || !["http:", "https:"].includes(link.protocol)) {
    throw Error("Invalid account email link");
  }
  const title = kind === "verify" ? "Verify your InfraForge email" : "Reset your InfraForge password";
  return { to, subject: title,
    text: `${title}. This link expires in 30 minutes and can be used once. If you did not request it, ignore this email.\n\n${url}`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>This link expires in 30 minutes and can be used once.</p><p><a href="${escape(url)}">${title}</a></p><p>If you did not request it, ignore this email.</p></body></html>` };
}
