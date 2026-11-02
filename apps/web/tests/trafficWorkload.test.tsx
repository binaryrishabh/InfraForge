import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { describeWorkload } from "../src/lib/format";
import { SourceInputFacts } from "../src/features/reports/components/SourceInputFacts";
import { WORKLOAD_PRESETS, withWorkloadDynamics } from "../src/features/deployment/workloadOptions";
import { WorkloadDynamicsControls } from "../src/features/deployment/components/WorkloadDynamicsControls";

test("existing presets retain omitted dynamics; Bursty API alone opts into Poisson and Moderate CV", () => {
  expect(WORKLOAD_PRESETS.map(p => p.label)).toEqual(["Steady", "Peak hours", "Flash sale", "Bot traffic", "Write-heavy", "Bursty API"]);
  expect(WORKLOAD_PRESETS.slice(0, 5).every(p => !Object.hasOwn(p.profile, "workloadDynamics"))).toBe(true);
  expect(WORKLOAD_PRESETS[5]!.profile.workloadDynamics).toEqual({ version: 1, arrivalProcess: "poisson", applicationCpuCv: 0.5 });
  const old = WORKLOAD_PRESETS[0]!.profile;
  const random = withWorkloadDynamics(old, { arrivalProcess: "poisson" });
  expect(random.workloadDynamics).toEqual({ version: 1, arrivalProcess: "poisson", applicationCpuCv: 0 });
  expect(withWorkloadDynamics(random, { applicationCpuCv: 1 }).workloadDynamics).toEqual({ version: 1, arrivalProcess: "poisson", applicationCpuCv: 1 });
  expect(old).not.toHaveProperty("workloadDynamics");
});

test("arrival and CPU controls show named levels, exact CVs, useful hints and loading locks", () => {
  const html = renderToStaticMarkup(<WorkloadDynamicsControls profile={WORKLOAD_PRESETS[0]!.profile} onChange={() => {}} disabled />);
  for (const text of ["Arrival pattern", "Even", "Random (Poisson)", "Same average rate. Random traffic arrives unevenly, so short bursts can form naturally.",
    "Application work variability", "Fixed", "Moderate", "High", "Fixed = CV 0", "Moderate = CV 0.5", "High = CV 1", "exponential"]) expect(html).toContain(text);
  expect(html.match(/disabled=""/g)).toHaveLength(5);
});

test("workload descriptions and source/rerun facts retain arrivals, variable CPU CV and captured seed", () => {
  for (const preset of [WORKLOAD_PRESETS[0]!, WORKLOAD_PRESETS[5]!]) {
    const text = describeWorkload(preset.profile);
    const html = renderToStaticMarkup(<SourceInputFacts workload={preset.profile} seed="captured-traffic-seed" />);
    for (const view of [text, html]) {
      expect(view).toContain(preset.id === "bursty-api" ? "Poisson arrivals" : "Even arrivals");
      expect(view).toContain(preset.id === "bursty-api" ? "Variable app CPU: Moderate (CV 0.5)" : "Fixed app CPU (CV 0)");
    }
    expect(html).toContain("captured-traffic-seed");
  }
});

test("choosing Even and Fixed again returns exactly the historical preset form", () => {
  const steady = WORKLOAD_PRESETS[0]!.profile;
  const random = withWorkloadDynamics(withWorkloadDynamics(steady, { arrivalProcess: "poisson" }), { applicationCpuCv: 0.5 });
  const back = withWorkloadDynamics(withWorkloadDynamics(random, { arrivalProcess: "even" }), { applicationCpuCv: 0 });
  expect(back).not.toHaveProperty("workloadDynamics");
  expect(JSON.stringify(back)).toBe(JSON.stringify(steady));
  // Poisson with fixed work is a real choice and stays explicit.
  expect(withWorkloadDynamics(steady, { arrivalProcess: "poisson" }).workloadDynamics).toEqual({ version: 1, arrivalProcess: "poisson", applicationCpuCv: 0 });
});
