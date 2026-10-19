import { createHash } from "node:crypto";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  if (typeof value === "string") return JSON.stringify(value.replaceAll("\r\n", "\n"));
  return JSON.stringify(value);
}
export const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export function withoutSidecar(layout: Record<string, unknown>) {
  const { firstStack: _sidecar, ...original } = layout;
  return original;
}
export const designRevision = (layout: Record<string, unknown>) => hash(withoutSidecar(layout));
