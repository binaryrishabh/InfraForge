import type { ChallengeDefinition, ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { recordedScenario } from "../challenges/scenario";
import { buildRunReport } from "../reports/report";
import { answers, attemptRow, definition, REFERENCE } from "./challengeHarness";

// Both the raw engine observer and the production capture/report route run the
// same saved inputs. Successful evidence is never a hand-authored counter object.
export function resilienceFixture(d: ChallengeDefinition, design: ChallengeStarter) {
  const input = captureRunInputs(design, d.workload, challengeSeed(d));
  const run = createModel2Run(input, d.evaluationSeconds), scenario = recordedScenario(d, input);
  const samples = [];
  for (let second = 1; second <= d.evaluationSeconds; second++) {
    run.advance();
    for (const step of scenario?.steps.filter(s => s.atSecond === second) ?? []) {
      run.apply({kind: "intervention", parameters: step.request});
      while (run.catchingUp) run.catchUp(10);
    }
    const raw = run.evidence();
    samples.push({second, metrics: run.view().metrics.lb!, lb: raw.network.loadBalancers.find(lb => lb.id === "lb")!, paths: raw.network.paths.filter(p => p.source === "lb" && p.circuitBreaker)});
  }
  const row = attemptRow(d, design, answers(d, {"overall-health": "healthy"}));
  return {input, row, samples, report: buildRunReport(row)};
}

export function resilienceCases() {
  const d = definition("test-a-circuit-again"), near = structuredClone(d.starter!);
  near.resources.find(r => r.id === "lb")!.circuitBreaker!.cooldownMs = 5000;
  const circuits = [d.starter!, REFERENCE[d.id]!, near].map(design => resilienceFixture(d, design));
  const retryD = definition("retrying-a-full-pool"), reserved = structuredClone(retryD.starter!);
  reserved.resources.find(r => r.id === "lb")!.retry!.maxConcurrentRetries = 4;
  reserved.resources.find(r => r.id === "lb")!.retry!.backoffMs = 100;
  const retries = [retryD.starter!, reserved].map(design => resilienceFixture(retryD, design));
  const earlyProbe = structuredClone(d.starter!);
  earlyProbe.resources.find(r => r.id === "lb")!.circuitBreaker!.cooldownMs = 100;
  const failedProbes = resilienceFixture(d, earlyProbe);
  const twoPaths = structuredClone(d.starter!);
  twoPaths.resources.push({...twoPaths.resources.find(r => r.id === "app")!, id: "peer", y: 240});
  twoPaths.connectionLines.push({...twoPaths.connectionLines[0]!, id: "lb-peer", targetId: "peer"});
  const multiPath = resilienceFixture(d, twoPaths);
  return {circuits, retries, failedProbes, multiPath};
}

if (import.meta.main) {
  const {circuits, retries, failedProbes, multiPath} = resilienceCases();
  const base = retries[1]!.row;
  const variant = (mutate: (row: typeof base) => void) => { const row = structuredClone(base); mutate(row); return buildRunReport(row); };
  const oldCircuit = structuredClone(circuits[1]!.row);
  delete (oldCircuit.terminalSnapshot as SimulationSnapshot).metrics.lb!.circuitBreaker;
  console.log(JSON.stringify({reports: [...circuits, ...retries, failedProbes, multiPath].map(c => c.report),
    oldRetry: variant(row => { row.simulationState = structuredClone(row.terminalSnapshot); delete (row.terminalSnapshot as SimulationSnapshot).metrics.lb!.lbRetry; }),
    oldCircuit: buildRunReport(oldCircuit),
    malformed: variant(row => { (row.terminalSnapshot as SimulationSnapshot).metrics.lb!.lbRetry!.activeRetries = -1; }),
    checkpointOnly: variant(row => { row.simulationState = row.terminalSnapshot; row.terminalSnapshot = null; }),
  }));
}
