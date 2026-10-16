import type { MeteringConfig, StoredObject } from "./contracts";

export function count(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw Error("Exact nonnegative safe integer required");
  return BigInt(value);
}
export function text(value: string, max = 4096) {
  if (typeof value !== "string" || !value || value.length > max) throw Error("Missing or over-budget usage identity");
  return value;
}
export const objectKey = (row: Pick<StoredObject, "namespace" | "key">) => JSON.stringify([row.namespace, row.key]);
export function objectRow(row: StoredObject) {
  text(row.namespace, 160); text(row.key, 160); count(row.bytes); count(row.generation);
  return { namespace: row.namespace, key: row.key, bytes: row.bytes, generation: row.generation };
}
export function configValid(c: MeteringConfig) {
  if (c.schema !== "infraforge-usage-metering/1" || !/^[a-f0-9]{64}$/.test(c.inputFingerprint) || !Array.isArray(c.provenance) || !c.provenance.length || c.provenance.length > 16) throw Error("Usage version/input/provenance required");
  text(c.run, 160); text(c.epoch, 160); c.provenance.forEach((s) => text(s, 512));
  for (const ids of [c.objects, c.links]) {
    if (!Array.isArray(ids) || ids.length > 256 || new Set(ids).size !== ids.length) throw Error("Usage selection identity/budget");
    ids.forEach((id) => text(id, 160));
  }
  if (!c.objects.length && !c.links.length) throw Error("At least one explicit usage selection required");
  for (const [value, max] of [[c.maxRecords, 20000], [c.maxFields, 250000], [c.maxTextCharacters, 2000000]]) if (!Number.isSafeInteger(value) || value! < 1 || value! > max!) throw Error("Usage retention budget invalid");
}
export function retainedSize(value: unknown, fieldLimit: number, textLimit: number) {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let fields = 0, characters = 0;
  while (pending.length) {
    const next = pending.pop()!;
    if (++fields > fieldLimit || next.depth > 24) throw Error("Usage field/depth retention budget exhausted");
    if (typeof next.value === "string") characters += next.value.length;
    else if (typeof next.value === "number") count(next.value);
    else if (next.value && typeof next.value === "object") for (const [key, child] of Object.entries(next.value)) { characters += key.length; pending.push({ value: child, depth: next.depth + 1 }); }
    else if (next.value !== null && typeof next.value !== "boolean") throw Error("Unsupported usage value");
    if (characters > textLimit) throw Error("Usage text retention budget exhausted");
  }
  return { fields, characters };
}
