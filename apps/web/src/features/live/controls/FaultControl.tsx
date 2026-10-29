import { useState } from "react";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import { INTERVENTIONS, interventionError, interventionMaximum, type Resource, type InterventionTarget } from "@infraforge/domain/resource";
import { applyIntervention } from "@/api/deployment.api";
import { errorMessage } from "@/api/errorMessage";
import { browserRunFor } from "@/features/model2Run/browserRuns";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { Button } from "@/ui/Button";
import { Field, Input, Select } from "@/ui/Field";
import { ControlBlock } from "./ControlBlock";
const targetKey = (t: InterventionTarget) => "resourceId" in t ? `resource:${t.resourceId}` : `edge:${t.edgeId}:${t.direction}`;
export function FaultControl({ deploymentId, resources, fixedTarget }: { deploymentId: string; resources: Resource[]; fixedTarget?: string }) {
  useSimulationStore(s => s.simulatedSeconds); // Worker capabilities refresh with each shown second.
  const capabilities = browserRunFor(deploymentId)?.interventions;
  const options = (capabilities?.options ?? []).filter(o => !fixedTarget || ("resourceId" in o.target && o.target.resourceId === fixedTarget));
  const [requested, setRequested] = useState("");
  const target = options.some(o => targetKey(o.target) === requested) ? requested : options[0] ? targetKey(options[0].target) : "";
  const available = options.filter(o => targetKey(o.target) === target);
  const [selected, setSelected] = useState("");
  const option = available.find(o => o.interventionId === selected) ?? available[0];
  const chosen = INTERVENTIONS.find(d => d.id === option?.interventionId && d.revision === option.revision);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const bounds = {authoredBaseline: option?.authoredBaseline, remainingSeconds: capabilities?.remainingSeconds};
  const valueFor = (name: string) => values[`${target}:${chosen?.id}:${name}`] ?? "";
  const parameters = Object.fromEntries((chosen?.parameters ?? []).map(p => [p.name, p.kind === "boolean" ? valueFor(p.name) === "true" : p.kind === "enum" ? valueFor(p.name) : valueFor(p.name) === "" ? NaN : Number(valueFor(p.name))]));
  const request = option && chosen ? {interventionId: chosen.id, revision: chosen.revision, target: option.target, parameters} : null;
  const error = request ? interventionError(request, bounds) : "No supported intervention for this target.";
  const inject = async () => {
    if (!request || error) return;
    setBusy(true);
    try { await applyIntervention(deploymentId, request); toast.info(`${chosen!.label} applied`); }
    catch (error) { toast.error(errorMessage(error, "The intervention could not be applied.")); }
    finally { setBusy(false); }
  };
  const label = (t: InterventionTarget) => "resourceId" in t ? resources.find(r => r.id === t.resourceId)?.name || t.resourceId : `${t.edgeId} (${t.direction})`;
  return <ControlBlock title="Apply an intervention" aside="Product policy v1">
    <div className="flex flex-col gap-2">
      {!fixedTarget && <Field label="Target">{({id}) => <Select id={id} value={target} onChange={e => setRequested(e.target.value)}>
        {[...new Map(options.map(o => [targetKey(o.target), o.target])).entries()].map(([key, t]) => <option key={key} value={key}>{label(t)}</option>)}
      </Select>}</Field>}
      {chosen && option ? <>
        <Field label="Intervention">{({id}) => <Select id={id} value={chosen.id} onChange={e => setSelected(e.target.value)}>
          {available.map(o => <option key={o.interventionId} value={o.interventionId}>{INTERVENTIONS.find(d => d.id === o.interventionId)!.label}</option>)}
        </Select>}</Field>
        {chosen.parameters.map(p => <Field key={p.name} label={`${p.name} (${p.unit})`} hint={`Product policy: ${p.min ?? "Unknown"} to ${interventionMaximum(p, bounds) ?? "Unknown"} ${p.unit}`}>{({id}) =>
          p.kind === "boolean" || p.kind === "enum" ? <Select id={id} value={valueFor(p.name)} onChange={e => setValues({...values, [`${target}:${chosen.id}:${p.name}`]: e.target.value})}>
            <option value="">Choose</option>{(p.kind === "boolean" ? ["true", "false"] : p.values ?? []).map(v => <option key={v}>{v}</option>)}
          </Select> : <Input id={id} type="number" min={p.min} max={interventionMaximum(p, bounds)} step={p.kind === "integer" ? 1 : "any"} value={valueFor(p.name)} onChange={e => setValues({...values, [`${target}:${chosen.id}:${p.name}`]: e.target.value})} />
        }</Field>)}
        {"edgeId" in option.target && <p className="text-xs">Shared-link blast radius: {option.resolvedTargets.join(", ")}. Affected paths: {option.affectedPaths.join(", ")}.</p>}
        <p className="text-xs">{chosen.endPolicy === "timed" ? "Restores the authored baseline when the duration ends. Existing effects remain." : "Applies once. Deleted cache entries stay deleted until refilled."}</p>
        <Button variant="secondary" size="sm" icon={<Zap size={14} aria-hidden="true" />} loading={busy} disabled={!!error} onClick={() => void inject()}>Apply {chosen.label.toLowerCase()}</Button>
      </> : <p className="text-xs">{capabilities ? "No supported intervention for this target." : "Intervention capabilities are Unknown until the browser run reports them."}</p>}
    </div>
  </ControlBlock>;
}
