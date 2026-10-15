// One-time review of the frozen M2G inventory. It never classifies newly scanned controls.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { shippingRoot, type ShippingEntry, type SurfaceCategory } from "./shipping-inventory";
export function reviewM2g(e: ShippingEntry): SurfaceCategory {
  const d = e.description, s = e.source;
  if (e.kind === "resource") return "RESOURCE_TYPE";
  if (e.kind === "chaos") return "FAULT_CONTROL";
  if (e.kind === "field") {
    if (/^(Resource\.(x|y|size|name)|ConnectionLine\.(id|sourceType|targetType))$/.test(e.identity)) return "PRESENTATION_ONLY";
    if (/Resource\.(public|encryption|openPorts)/.test(e.identity)) return "SECURITY_CONTROL";
    if (/Resource\.(skuId|region)/.test(e.identity)) return "COST_INPUT_OR_OUTPUT";
    if (/^WorkloadProfile\./.test(e.identity)) return "WORKLOAD_INPUT";
    return "INFRA_INPUT";
  }
  if (e.kind === "display") {
    // These render authored labels/positions or application bookkeeping, not measurements.
    if (/HeroDiagram|CanvasBoard|Palette|CanvasResourceItem|ConnectionLinesLayer|Inspector\.tsx|ConnectionsSection/.test(s) && !/cpu|memory|health|rps|cost|capacity|replica|security|finding|sku/i.test(d)) return "PRESENTATION_ONLY";
    if (/resource\.(name|id|type)|resourceCount|resources\.length|resource\.x|resource\.y/.test(d) && !/cpu|memory|health|rps|cost|capacity|replica|sku|security|finding|metrics/i.test(d)) return "PRESENTATION_ONLY";
    if (/cost|monthly|price|sku/i.test(d)) return "COST_INPUT_OR_OUTPUT";
    if (/public|encryption|openPorts|finding|security/i.test(d)) return "SECURITY_CONTROL";
    return "INFRA_OUTPUT"; // Mixed fragments retain their strongest technical claim.
  }
  if (/ExposureSection/.test(s)) return "SECURITY_CONTROL";
  if (/InstanceSection|ResizeControl/.test(s) && /label="Provider"/.test(d) && /setProvider/.test(d)) return "PRESENTATION_ONLY";
  if (/InstanceSection|ResizeControl/.test(s)) return "COST_INPUT_OR_OUTPUT";
  if (/AutoscalingSection|PoolControl/.test(s)) return "INFRA_INPUT";
  if (/FaultControl/.test(s)) return "FAULT_CONTROL";
  if (/LoadControl/.test(s)) return "WORKLOAD_INPUT";
  if (/NodeCard|NodeLive|HealthMark/.test(s) || /value=\{(?:metric|r\?|point\?)/.test(d)) return "INFRA_OUTPUT";
  if (/DeployDialog|RerunDialog/.test(s) && /targetThroughput|throughputUnit|trafficShape|peakMultiplier|readWriteRatio|payloadSize|profile\[|profile\.|setProfile\(|name="preset"/.test(d)) return "WORKLOAD_INPUT";
  if (/renameDesign|saveAsNew|onRun|runDesign|requestRun|submit.*run|Run again|Save and run|Lock prediction and run|Save canvas and run again/i.test(d)) return "PRODUCT_UI_ACTION";
  // Editing topology is semantic intent even though edge-to-path meaning needs review.
  if (/onRemove|deleteConnection|connectResources|startConnection|onStartConnection|addResource/.test(d)) return "INFRA_INPUT";
  if (/Pan|Zoom|fitCanvas|onCollapse|onExpand|setRail|setTab|onTab|setTarget|setChosen|onSelect|onPointer|setQuery/.test(d)) return "PRESENTATION_ONLY";
  return "PRODUCT_UI_ACTION";
}
if (import.meta.main) {
  const path = resolve(shippingRoot, "docs/reality/shipping-reality.json"), data = JSON.parse(readFileSync(path, "utf8"));
  if (data.schema !== "infraforge-shipping-reality/1") throw Error("M2G review may only run once against schema 1");
  for (const e of data.entries as ShippingEntry[]) {
    e.category = reviewM2g(e);
    const ui = ["PRODUCT_UI_ACTION", "PRESENTATION_ONLY"].includes(e.category);
    e.categoryReason = ui ? "Reviewed software interaction or authored presentation; makes no infrastructure performance/security claim" : "Retains infrastructure intent or technical evidence claim; requires actual Model-2 semantics";
    e.ui = { status: ui ? "REVIEW_REQUIRED" : "NOT_APPLICABLE", behavior: ui ? e.description : "Separate infrastructure reality gate", proofs: [] };
    if (ui) { Object.assign(e, { legacyM2gStatus: e.status }); e.status = "NOT_APPLICABLE"; e.model2Owner = "NOT_APPLICABLE"; e.finalProductEligible = false; e.plan = "Prove this software behavior through PRODUCT_UI_VALIDITY; no physics owner required. Historical M2G status retained for audit."; }
    else if (e.status === "REAL") { e.status = "PARTIAL"; e.finalProductEligible = false; e.plan = "Review actual Model-2 owner/evidence before eligibility; software behavior alone proves no infrastructure semantics"; }
  }
  data.schema = "infraforge-shipping-reality/2";
  data.scope = "Frozen M2G surfaces semantically separated. UI behavior review is independent of Model-2 physics; new fingerprints remain UNREVIEWED.";
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}
