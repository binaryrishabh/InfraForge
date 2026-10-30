import type { ChallengeScenario } from "@infraforge/contracts/challenges";
import { INTERVENTIONS, type Resource } from "@infraforge/domain/resource";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";

// The revealed schedule comes from the exact-version brief. Only worker events establish application.
export function ScenarioSchedule({ deploymentId, scenario, resources }: { deploymentId: string; scenario?: ChallengeScenario; resources: Resource[] }) {
  const logs = useSimulationStore(s => s.deploymentId === deploymentId ? s.logs : null);
  if (!scenario || scenario.visibility !== "revealed") return null;
  const name = (id: string) => resources.find(r => r.id === id)?.name || id;
  return <div aria-label="Challenge scenario schedule" className="text-sm text-ink-2">
    <p className="font-semibold">Challenge schedule</p>
    <ul className="mt-1 space-y-2">{scenario.steps.map(step => {
      const request = step.request;
      const label = INTERVENTIONS.find(d => d.id === request.interventionId && d.revision === request.revision)?.label ?? request.interventionId;
      const target = "resourceId" in request.target ? name(request.target.resourceId) : `${request.target.edgeId} (${request.target.direction})`;
      const applied = logs?.some(log => log.source === "model-2" && log.message === `Scenario step applied: ${step.id} at second ${step.atSecond}.`);
      return <li key={step.id}>
        <p>{step.id}: {label} on {target}. Scheduled at simulated second {step.atSecond}.</p>
        {request.parameters.duration !== undefined && <p>Scheduled duration: {request.parameters.duration} simulated seconds.</p>}
        <p>{applied ? `Applied at simulated second ${step.atSecond} (worker event).` : "Application: Unknown; no worker application event available."} Ended: Unknown.</p>
      </li>;
    })}</ul>
  </div>;
}
