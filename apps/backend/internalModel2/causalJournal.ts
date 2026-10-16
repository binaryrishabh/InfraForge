import { z } from "zod";
import type { CausalEvent, CausalObserver } from "@infraforge/simulation/internal-product";
import type { CausalLimits } from "./connectedScope";
type Identity = [number, number, number | null, number, number, number];
type Detail = Record<string, number | boolean | null | [number]>;
type Row = [number, number, number, number | null, Detail];
export interface CausalCapture { schema: "infraforge-causal/1"; limits: CausalLimits; strings: string[]; identities: Identity[]; rows: Row[]; offered: number; omitted: number; firstOmittedAt: number | null; complete: boolean }
export function causalJournal(limits: CausalLimits) {
  const strings: string[] = [], identities: Identity[] = [], rows: Row[] = [], texts = new Map<string, number>(), calls = new Map<string, number>();
  let characters = 0, offered = 0, omitted = 0, firstOmittedAt: number | null = null;
  const text = (s: string) => {
    const old = texts.get(s); if (old !== undefined) return old;
    if (characters + s.length > limits.textCharacters || strings.length >= 2048) throw Error("Causal text budget");
    const id = strings.length; characters += s.length; strings.push(s); texts.set(s, id); return id;
  };
  const observe: CausalObserver = (event) => {
    offered++;
    try {
      if (omitted || rows.length >= limits.events) throw Error("Causal row budget");
      let identity: number | null = null;
      if (event.work) {
        const w = event.work; identity = calls.get(w.callId) ?? null;
        if (identity === null) {
          if (identities.length >= limits.identities) throw Error("Causal identity budget");
          const row: Identity = [text(w.rootId), text(w.callId), w.parentCallId === undefined ? null : text(w.parentCallId), w.attempt, text(w.operation), w.offeredAt];
          identity = identities.length; identities.push(row); calls.set(w.callId, identity);
        }
      }
      const detail = Object.fromEntries(Object.entries(event.detail).map(([key, v]) => [key, typeof v === "string" ? [text(v)] : v])) as Detail;
      rows.push([event.atUs, text(event.kind), text(event.resource), identity, detail]);
    } catch { omitted++; firstOmittedAt ??= event.atUs; }
  };
  return { observe, capture: (): CausalCapture => structuredClone({ schema: "infraforge-causal/1", limits, strings, identities, rows, offered, omitted, firstOmittedAt, complete: omitted === 0 }) };
}
const integer = z.number().int().nonnegative(), reference = integer.nullable();
const identity = z.tuple([integer, integer, reference, integer, integer, integer]);
const row = z.tuple([integer, integer, integer, reference, z.record(z.string().max(32), z.union([z.number().finite(), z.boolean(), z.null(), z.tuple([integer])]))]);
export function readCausal(value: unknown): CausalCapture {
  const e = z.object({ schema: z.literal("infraforge-causal/1"), limits: z.object({ events: integer.positive().max(512), identities: integer.positive().max(128), textCharacters: integer.positive().max(65536) }).strict(), strings: z.array(z.string()).max(2048), identities: z.array(identity).max(128), rows: z.array(row).max(512), offered: integer, omitted: integer, firstOmittedAt: reference, complete: z.boolean() }).strict().parse(value) as CausalCapture;
  const s = (n: number) => { if (n >= e.strings.length) throw Error("Missing causal string"); };
  if (e.rows.length > e.limits.events || e.identities.length > e.limits.identities || e.strings.reduce((n, v) => n + v.length, 0) > e.limits.textCharacters || e.offered !== e.rows.length + e.omitted || e.complete !== (e.omitted === 0) || (e.firstOmittedAt === null) !== e.complete) throw Error("Causal retention metadata mismatch");
  for (const w of e.identities) { s(w[0]); s(w[1]); if (w[2] !== null) s(w[2]); s(w[4]); }
  if (new Set(e.identities.map(w => e.strings[w[1]])).size !== e.identities.length || new Set(e.strings).size !== e.strings.length) throw Error("Duplicate causal dictionary identity");
  let at = 0;
  for (const r of e.rows) { if (r[0] < at || r[3] !== null && r[3] >= e.identities.length) throw Error("Causal event order/identity mismatch"); at = r[0]; s(r[1]); s(r[2]); for (const v of Object.values(r[4])) if (Array.isArray(v)) s(v[0]); }
  if (e.firstOmittedAt !== null && e.firstOmittedAt < at) throw Error("Causal omission watermark precedes retained events");
  return e;
}
export function decodeCausal(value: unknown): CausalEvent[] {
  const e = readCausal(value), text = (n: number) => e.strings[n]!;
  return e.rows.map(([atUs, kind, resource, call, detail]) => {
    const w = call === null ? null : e.identities[call]!;
    return { atUs, kind: text(kind), resource: text(resource), ...(w ? { work: { rootId: text(w[0]), callId: text(w[1]), ...(w[2] === null ? {} : { parentCallId: text(w[2]) }), attempt: w[3], operation: text(w[4]), offeredAt: w[5] } } : {}), detail: Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, Array.isArray(v) ? text(v[0]) : v])) };
  });
}
