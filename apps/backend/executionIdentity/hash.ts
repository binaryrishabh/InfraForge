import { createHash } from "node:crypto";

export const lf = (text: string) => text.replaceAll("\r\n", "\n");
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
// Source identities ignore checkout line endings; resource and data bytes do not.
export const sourceHash = (text: string) => sha256(lf(text));
export function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, ordered(item)]));
  return value;
}
export const digest = (value: unknown) => sha256(JSON.stringify(ordered(value)));
