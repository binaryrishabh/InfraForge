import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RerunOptions, RunComparison } from "@infraforge/contracts/reports";
import { LiveGuideView } from "../src/features/live/LiveGuidePanel";
import { crashTarget, liveGuide } from "../src/features/live/liveGuide";
import { TrafficExperimentForm } from "../src/features/reports/components/TrafficExperimentDialog";
import { CompareView } from "../src/features/reports/components/CompareView";

type Guide = Parameters<typeof liveGuide>[0];
const sample: Array<{ id: string; type: string }> = [{ id: "dns-1", type: "DNS" }, { id: "lb-1", type: "Load Balancer" }, { id: "vm-1", type: "Virtual Machine" }, { id: "vm-2", type: "Virtual Machine" }, { id: "db-1", type: "Database" }];
const healthy = Object.fromEntries(sample.map(r => [r.id, { health: "healthy" }])) as Guide["metrics"];
const base: Guide = { resources: sample as Guide["resources"], metrics: healthy, activeChaos: [], faultSeen: false, simulatedSeconds: 10 };

test("nothing is suggested before the run has measured anything", () => {
  expect(liveGuide({ ...base, simulatedSeconds: 2 })).toBeNull();
});

test("a healthy run invites a fault on a server that leaves a sibling to take over", () => {
  const guide = liveGuide(base)!;
  expect(guide).toMatchObject({ stage: "break", title: "Everything is running. Now break something.", target: { id: "vm-2", label: "Crash vm-2 for 30 s" } });
  expect(crashTarget([{ id: "vm-1", type: "Virtual Machine" }] as never)).toEqual({ id: "vm-1", label: "Crash vm-1" });
  expect(crashTarget([{ id: "db-1", type: "Database" }] as never)).toBeNull();
  const html = renderToStaticMarkup(<LiveGuideView guide={guide} busy={false} onCrash={() => {}} />);
  expect(html).toContain("Crash vm-2 for 30 s"); expect(html).toContain('aria-live="polite"');
});

test("during a fault the guide reports only what the run measured, and says so when nothing has changed yet", () => {
  const chaos = [{ chaosType: "crash", resourceId: "vm-2", remainingTicks: 22 }] as Guide["activeChaos"];
  const quiet = liveGuide({ ...base, activeChaos: chaos, faultSeen: true })!;
  expect(quiet).toMatchObject({ stage: "watch", title: "Crash on vm-2 · 22 s left" });
  expect(quiet.body).toContain("Nothing else has changed yet");
  const measured = { ...healthy, "vm-2": { health: "failed" }, "vm-1": { health: "saturated" } } as Guide["metrics"];
  const watch = liveGuide({ ...base, metrics: measured, activeChaos: chaos, faultSeen: true })!;
  expect(watch.body).toContain("vm-2 has failed"); expect(watch.body).toContain("vm-1 is under strain");
  expect(watch.body).not.toContain("saturated");
  // A guide with a fault under way never offers another crash.
  expect(renderToStaticMarkup(<LiveGuideView guide={watch} busy={false} onCrash={() => {}} />)).not.toContain("<button");
});

test("after the fault the guide says what has and has not recovered and points to the report and the experiment", () => {
  const recovered = liveGuide({ ...base, faultSeen: true })!;
  expect(recovered).toMatchObject({ stage: "understand", title: "The fault is over and the system has recovered" });
  expect(recovered.body).toContain("Every resource is healthy again.");
  expect(recovered.body).toContain("It does not repeat your fault.");
  const lingering = liveGuide({ ...base, faultSeen: true, metrics: { ...healthy, "vm-1": { health: "degraded" } } as Guide["metrics"] })!;
  expect(lingering.title).toBe("The fault is over; recovery is still under way");
  expect(lingering.body).toContain("vm-1 has not recovered yet; a restart takes time after the fault ends.");
  expect(lingering.body).toContain("Change traffic and run again");
});

test("a traffic experiment warns, before it starts, that the source run's actions are not repeated", () => {
  const options = { source: { id: "s" }, workload: null, seed: "x", exact: { available: true, reason: null },
    currentDesign: { available: false, reason: null, preview: null, inputHash: null, modelCatalogCompatible: false },
    workloadVariant: { available: true, reason: null, source: { arrivalProcess: "even", applicationCpuVariability: "fixed" }, choices: [] },
    matchedStop: { available: true, target: 87, defaultEnabled: true, reason: null } } as unknown as RerunOptions;
  const render = (actions: number) => renderToStaticMarkup(<MemoryRouter><TrafficExperimentForm id="s" options={options} close={() => {}} onBusy={() => {}} sourceActions={actions} /></MemoryRouter>);
  expect(render(0)).not.toContain("Your actions are not repeated");
  expect(render(1)).toContain("This run included 1 action of yours");
  const many = render(3);
  expect(many).toContain("Your actions are not repeated"); expect(many).toContain("3 actions of yours");
  expect(many).toContain("cannot credit any difference to the traffic change alone");
});

test("the comparison says when the recorded actions differ as well as the traffic setting", () => {
  const run = { id: "a", infrastructureId: null, infrastructureName: "Design", status: "torn-down", createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T00:00:00.000Z",
    resourceCount: 1, workload: null, workloadSource: "captured", chaosEventCount: 0, topologyRevision: 0, hasReportData: true };
  const comparison = (code: "same" | "different") => ({ version: 1, runs: [run, { ...run, id: "b" }], available: true, unavailableReason: null, lineage: "source-and-rerun", headline: "starting-inputs-only",
    starting: { grade: "one-change-workload", facets: { inputVersion: "same", model: "same", catalog: "same", workload: "different", seed: "same", topology: "same", resourceOrder: "same" }, design: null,
      workload: [{ field: "workloadDynamics", earlier: null, later: { version: 1, arrivalProcess: "poisson", applicationCpuCv: 0 } }], alignment: { code: "unknown", aligned: [], shifted: [], scope: "x" } },
    conduct: { code, actions: [[], []], speedNote: "", reasons: [] }, evidence: { code: "both-exact", states: [null, null], matchedDuration: true, deterministicState: "not-established" },
    outcomes: [], resources: [], costs: [], gates: [[], []], challengeConditions: null, observed: [], interpreted: [], unknown: [] }) as unknown as RunComparison;
  const render = (code: "same" | "different") => renderToStaticMarkup(<MemoryRouter><CompareView comparison={comparison(code)} /></MemoryRouter>);
  expect(render("different")).toContain("The recorded actions differ too");
  expect(render("same")).not.toContain("The recorded actions differ too");
  expect(render("different")).toContain("Arrival pattern: Even → Random (Poisson)");
});

test("the store remembers that a fault ran, across snapshots, until the next run is prepared", async () => {
  const { useSimulationStore } = await import("../src/features/monitoring/store/simulationStore");
  const snapshot = (activeChaos: unknown[]) => ({ deploymentId: "r1", timestamp: "t", simulatedSeconds: 5, loadFraction: 1, metrics: {}, logs: [], health: "healthy",
    pools: {}, spawnedVms: [], restarting: [], activeChaos, speed: 1, burnRatePerHourUsd: 0, accumulatedCostUsd: 0 }) as never;
  const store = useSimulationStore;
  store.getState().prepareRun("r1");
  expect(store.getState().faultSeen).toBe(false);
  store.getState().applySnapshot(snapshot([]));
  expect(store.getState().faultSeen).toBe(false);
  store.getState().applySnapshot(snapshot([{ chaosType: "crash", resourceId: "vm-2", durationTicks: 30, remainingTicks: 20 }]));
  expect(store.getState().faultSeen).toBe(true);
  store.getState().applySnapshot(snapshot([]));
  expect(store.getState().faultSeen).toBe(true);
  store.getState().prepareRun("r2");
  expect(store.getState().faultSeen).toBe(false);
});
