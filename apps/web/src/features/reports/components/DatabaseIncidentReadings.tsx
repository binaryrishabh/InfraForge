import type { RunReport } from "@infraforge/contracts/reports";
import { DatabaseReplicationReadings } from "@/features/live/DatabaseReplicationReadings";

export function DatabaseIncidentReadings({report}: {report: RunReport}) {
  const plan = report.databaseRecoveryPlan;
  if (!plan) return null;
  const incidents = report.actions.flatMap(action => action.outcome?.databaseIncident ? [{action, incident: action.outcome.databaseIncident}] : []);
  return <section aria-label="Database incident record" className="mt-5">
    <h3 className="font-semibold">Database incident record</h3>
    <p>{plan.resourceId}: {plan.promoteAtSecond === null ? "No promotion scheduled" : `Promotion scheduled after second ${plan.promoteAtSecond}`}.</p>
    <details><summary>Captured recovery plan hash</summary><p className="break-all">{plan.hash}</p></details>
    <p>Measurements retained by server replay at action boundaries. Counts are cumulative through each sample; a sample does not establish continuous recovery or provider failover time.</p>
    {!incidents.length && <p>Incident samples: Unknown</p>}
    {incidents.map(({action, incident}) => <div key={action.id}>
      <h4 className="mt-3 font-semibold">{action.scenarioStepId ?? action.id}</h4>
      {(["before", "during", "after"] as const).map(phase => {
        const sample = incident[phase];
        return <section key={phase} aria-label={`${action.scenarioStepId ?? action.id}: ${phase}`}>
          <p>{phase === "before" ? "Before action" : phase === "during" ? "First sample after action" : "At action completion"}: {sample ? `second ${sample.simulatedSecond}` : "Unknown"}.</p>
          <p>Completed callers: {sample?.completed ?? "Unknown"}; failed callers: {sample?.failed ?? "Unknown"}.</p>
          {sample?.replication ? <DatabaseReplicationReadings metrics={{databaseReplication: sample.replication}} resourceId={incident.resourceId} /> : <p>Database replication: Unknown</p>}
        </section>;
      })}
    </div>)}
  </section>;
}
