import type { ObservedHealthSample } from "@infraforge/contracts/reports";

export function healthySampleText(sample: ObservedHealthSample | null) {
  return sample ? `First retained Healthy sample ${sample.completeSinceFaultEnd ? "after the fault" : "after missing evidence"}: second ${sample.second}.`
    : "No retained Healthy sample after a verified fault end. Health in missing evidence is unknown.";
}
