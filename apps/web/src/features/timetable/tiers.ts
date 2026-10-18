export interface TierNode { id: string; type: string | null; label: string }
export interface TierEdge { source: string; target: string }
export interface Placed { id: string; col: number; row: number }

/* A layered map: each station's column is the longest path from an entry point, so traffic
reads left to right the way time does on the timetable. Within a column, stations follow
the average row of what feeds them, which keeps fan-out and fan-in straight. Cycles are
broken at the edge that would point backwards; nothing is dropped. */
export function layoutTiers(nodes: TierNode[], edges: TierEdge[]): { placed: Placed[]; cols: number; rows: number } {
  const ids = new Set(nodes.map((n) => n.id));
  const valid = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
  const out = new Map<string, string[]>(), into = new Map<string, string[]>();
  for (const n of nodes) { out.set(n.id, []); into.set(n.id, []); }
  // Depth-first order decides which edges are back edges.
  const state = new Map<string, 0 | 1 | 2>(), forward: TierEdge[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of valid.filter((v) => v.source === id)) {
      const s = state.get(e.target) ?? 0;
      if (s === 1) continue;
      forward.push(e); if (s === 0) visit(e.target);
    }
    state.set(id, 2);
  };
  const roots = nodes.filter((n) => !valid.some((e) => e.target === n.id));
  for (const n of [...roots, ...nodes]) if (!state.get(n.id)) visit(n.id);
  for (const e of forward) { out.get(e.source)!.push(e.target); into.get(e.target)!.push(e.source); }

  const col = new Map<string, number>();
  const depth = (id: string, seen = new Set<string>()): number => {
    if (col.has(id)) return col.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const d = Math.max(-1, ...into.get(id)!.map((p) => depth(p, seen))) + 1;
    col.set(id, d); return d;
  };
  for (const n of nodes) depth(n.id);

  const cols = Math.max(0, ...col.values()) + 1, rowOf = new Map<string, number>(), columns: string[][] = [];
  for (let c = 0; c < cols; c++) columns.push(nodes.filter((n) => col.get(n.id) === c).map((n) => n.id));
  for (const members of columns) {
    const keyed = members.map((id, i) => {
      const parents = into.get(id)!.filter((p) => rowOf.has(p));
      return { id, key: parents.length ? parents.reduce((s, p) => s + rowOf.get(p)!, 0) / parents.length : i, i };
    }).sort((a, b) => a.key - b.key || a.i - b.i);
    keyed.forEach((k, i) => rowOf.set(k.id, i));
  }
  const rows = Math.max(1, ...columns.map((m) => m.length));
  // Centre each column vertically against the tallest one.
  const placed = nodes.map((n) => {
    const c = col.get(n.id)!, size = columns[c]!.length;
    return { id: n.id, col: c, row: rowOf.get(n.id)! + (rows - size) / 2 };
  });
  return { placed, cols, rows };
}
