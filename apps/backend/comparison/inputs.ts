import type { RunInputs } from "@infraforge/contracts/run-inputs";
import type { StartingComparison } from "@infraforge/contracts/reports";
import { canonical, designDifference, fields, normalizedTopology, unambiguous } from "./design";

export function compareInputs(a: RunInputs | null, b: RunInputs | null): StartingComparison {
  const known = !!a && !!b && unambiguous(a) && unambiguous(b);
  const eq = (x: unknown, y: unknown) => canonical(x) === canonical(y) ? "same" as const : "different" as const;
  const facets: StartingComparison["facets"] = {
    inputVersion: a && b ? eq(a.version, b.version) : "unknown",
    model: a?.version === 2 && b?.version === 2 ? eq(a.simulationModelVersion, b.simulationModelVersion) : "unknown",
    catalog: a?.version === 2 && b?.version === 2 ? eq(a.catalogSnapshot, b.catalogSnapshot) : "unknown",
    workload: a && b ? eq(a.workloadProfile, b.workloadProfile) : "unknown",
    seed: a && b ? eq(a.seed, b.seed) : "unknown",
    topology: known ? eq(normalizedTopology(a!), normalizedTopology(b!)) : "unknown",
    resourceOrder: known ? eq(a!.resources.map((r) => r.id), b!.resources.map((r) => r.id)) : "unknown",
  };
  const compatible = known && facets.inputVersion === "same" && facets.model === "same" && facets.catalog === "same";
  const designChanged = facets.topology === "different" || facets.resourceOrder === "different";
  const count = Number(designChanged) + Number(facets.workload === "different") + Number(facets.seed === "different");
  const grade = !compatible ? "side-by-side-only" : count === 0 ? "same-starting-point" : count > 1 ? "several-things-changed" :
    designChanged ? "one-change-design" : facets.workload === "different" ? "one-change-workload" : "same-setup-different-seed";
  const alignment: StartingComparison["alignment"] = { code: "unknown", aligned: [], shifted: [],
    scope: "Shared captured starting resources only. Dynamic spawned resources are not graded. Matching positions describe random draws, not identical measurements or controlled causality." };
  const capturedOrderPreserved = (v: RunInputs) => canonical(v.resources.map((r) => r.id)) === canonical(Object.keys(Object.fromEntries(v.resources.map((r) => [r.id, null]))));
  if (known && a?.version === 2 && b?.version === 2 && a.simulationModelVersion === "1" && b.simulationModelVersion === "1" && facets.seed === "same" && capturedOrderPreserved(a) && capturedOrderPreserved(b)) {
    const positions = new Map(b.resources.map((r, i) => [r.id, i]));
    a.resources.forEach((r, i) => { const j = positions.get(r.id); if (j === undefined) return;
      if (i === j) alignment.aligned.push(r.id); else alignment.shifted.push({ id: r.id, earlierPosition: i, laterPosition: j }); });
    alignment.code = alignment.shifted.length ? "shifted" : "aligned";
  }
  if (known && (!capturedOrderPreserved(a!) || !capturedOrderPreserved(b!))) alignment.scope += " Numeric object-key ordering differs from captured array order; positional alignment is unknown for this pair.";
  return { grade, facets, alignment, design: known ? designDifference(a!, b!) : null,
    workload: a && b ? fields({ ...a.workloadProfile }, { ...b.workloadProfile }) : [] };
}
