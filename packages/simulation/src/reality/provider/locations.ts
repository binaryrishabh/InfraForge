import type { Location, Placement } from "./contracts";
export function locationIndex(locations: Location[]) {
  const byId = new Map(locations.map((l) => [l.id, l]));

  if (byId.size !== locations.length) throw Error("Duplicate location");

  for (const l of locations) {
    if (!l.id.startsWith(`${l.provider}:${l.partition}:`) || (l.kind === "region" ? l.parent !== undefined : !l.parent)) throw Error("Qualified stable location identity/hierarchy required; account zone aliases are not zone IDs");

    if (l.kind === "zone") {
      const p = byId.get(l.parent!);

      if (!p || p.kind !== "region" || p.provider !== l.provider || p.partition !== l.partition) throw Error("Zone parent provider/partition/region mismatch");
    }
  }

  const contains = (domain: string, location: string) => {
    if (!byId.has(domain) || !byId.has(location)) throw Error("Unknown location/domain");

    return domain === location || byId.get(location)!.parent === domain;
  };

  return { byId, contains };
}
export function relation(locations: Location[], a: string | undefined, b: string | undefined) {
  const { byId } = locationIndex(locations), left = a ? byId.get(a) : undefined, right = b ? byId.get(b) : undefined;

  if (!left || !right) return "Unknown";

  if (left.provider !== right.provider || left.partition !== right.partition) return "cross-provider-or-partition";

  if (left.kind === "zone" && right.kind === "zone" && left.id === right.id) return "same-zone";

  if ((left.parent ?? left.id) === (right.parent ?? right.id)) return "same-region";

  return "cross-region";
}
export function checkRelationships(locations: Location[], placements: Placement[], constraints: Array<{
  left: string;

  right: string;

  rule: "same-zone" | "different-zone"
}>) {
  const index = locationIndex(locations), byInstance = new Map(placements.map((p) => [p.instance, p.location]));

  if (byInstance.size !== placements.length) throw Error("Duplicate instance placement");

  for (const p of placements) if (!index.byId.has(p.location)) throw Error("Unknown placement location");

  for (const c of constraints) {
    const left = byInstance.get(c.left), right = byInstance.get(c.right), a = left ? index.byId.get(left) : undefined, b = right ? index.byId.get(right) : undefined;

    if (!a || !b || a.kind !== "zone" || b.kind !== "zone" || !["same-zone", "different-zone"].includes(c.rule)) throw Error("Relationship requires two explicit zone placements");

    if (a.provider !== b.provider || a.partition !== b.partition) throw Error("Zone anti-affinity is scoped to one provider partition");

    if ((a.id === b.id) !== (c.rule === "same-zone")) throw Error("Placement relationship violated");
  }
}
