import { useState } from "react";
import { RESOURCE_PORTS, securitySettingsError, type Resource, type FirewallSettings } from "@infraforge/domain/resource";
import type { SecurityMetrics } from "@infraforge/contracts/telemetry";
import { Switch } from "@/ui/Switch";
import { updateResource } from "../../actions";
import { useCanvasStore } from "../../store/canvasStore";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { InspectorSection } from "./InspectorSection";

function ListenerEditor({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const [ports, setPorts] = useState(resource.listenerSettings!.ports.join(", "));
  const settings = { version: 1 as const, ports: ports.trim() === "" ? [] : ports.split(",").map(p => p.trim() === "" ? NaN : Number(p)) };
  const error = securitySettingsError(resource.type, settings, undefined);
  return <form onSubmit={e => { e.preventDefault(); if (!error && !disabled) updateResource(resource.id, { listenerSettings: settings }); }}>
    <label>TCP listener ports (comma separated)<input disabled={disabled} value={ports} onChange={e=>setPorts(e.target.value)} /></label>
    <p>Leave empty for no listener. A call to any other port fails before backend delivery.</p>
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={disabled || !!error}>Apply ports</button>
  </form>;
}

export function SecurityReadings({ metrics }: { metrics?: SecurityMetrics }) {
  const text = (v: number | null | undefined) => v == null ? "Unknown" : String(v);
  return <div>
    {metrics?.firewall && <p>Firewall flows: {metrics.firewall.occupancy} / {metrics.firewall.limit}; new admissions: {metrics.firewall.admissions}; generation {metrics.firewall.generation}. Flow limit is an educational assumption.</p>}
    {!metrics && <p>Security measurements: Unknown</p>}
    {metrics?.evidence === "omitted" && <p>Security evidence omitted ({metrics.omitted ?? "Unknown"} rows); connection details: Unknown</p>}
    {metrics?.edges.map(e => <div key={e.path}>
      <p>{e.source} Ã¢â€ â€™ {e.target}: denied opens {text(e.denied)}; no listener {text(e.noListener)}; backend deliveries {text(e.backendDeliveries)}.</p>
      {e.policyDenied && Object.entries(e.policyDenied).map(([rule,count])=><p key={rule}>Denied by {rule}: {count}</p>)}
      {e.lastDenial && <p>Connection {e.lastDenial.connectionId}: {e.lastDenial.source} Ã¢â€ â€™ {e.lastDenial.target}:{e.lastDenial.port}, {e.lastDenial.reason}{e.lastDenial.generation ? ` (policy generation ${e.lastDenial.generation})` : ""}.</p>}
    </div>)}
  </div>;
}

export function SecuritySection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const resources = useCanvasStore(s=>s.resources);
  const metrics = useSimulationStore(s=>s.metrics[resource.id]?.security);
  // Invalid edits stay in the form so the person can correct them; only valid settings enter history.
  const [draft, setDraft] = useState({ saved: resource.firewallSettings, value: resource.firewallSettings });
  const firewall = resource.type === "Firewall", p = draft.saved === resource.firewallSettings ? draft.value : resource.firewallSettings;
  const error = securitySettingsError(resource.type, resource.listenerSettings, p, resources);
  const commit = (patch: Partial<FirewallSettings>) => {
    if (disabled) return;
    const next = { ...p!, ...patch };
    setDraft({ saved: resource.firewallSettings, value: next });
    if (!securitySettingsError(resource.type, resource.listenerSettings, next, resources)) updateResource(resource.id, { firewallSettings: next });
  };
  const change = (id: string, patch: Partial<FirewallSettings["rules"][number]>) => commit({rules:p!.rules.map(r=>r.id === id ? {...r,...patch} : r)});
  const add = () => { let n = 1; while (p!.rules.some(r=>r.id === `rule-${n}`)) n++; commit({rules:[...p!.rules,{id:`rule-${n}`,priority:100,direction:"ingress",source:"any",destination:"any",fromPort:1,toPort:65535,action:"deny"}]}); };
  return <InspectorSection title={firewall ? "Firewall policy" : "TCP listeners"}>
    <p>Educational TCP policy model; this does not certify any provider security product. TLS performance is Unknown.</p>
    {firewall ? <>
      <Switch label="Use explicit firewall policy" checked={p !== undefined} disabled={disabled} onChange={enabled=>updateResource(resource.id,{firewallSettings:enabled ? {version:1,default:"allow",rules:[]} : undefined})} />
      {!p && <p>Inferred policy allows all traffic.</p>}
      {p && <fieldset disabled={disabled}>
        <label>Default action<select value={p.default} onChange={e=>commit({default:e.target.value as "allow" | "deny"})}><option>allow</option><option>deny</option></select></label>
        <p>First matching rule per direction, ordered by priority then rule ID. Both egress and ingress must allow. Existing admitted connections survive rule changes.</p>
        {p.rules.map(r=><fieldset key={r.id}><legend>{r.id}</legend>
          <label>Priority<input type="number" min={0} max={65535} value={Number.isNaN(r.priority) ? "" : r.priority} onChange={e=>change(r.id,{priority:e.target.value === "" ? NaN : Number(e.target.value)})} /></label>
          <label>Direction<select value={r.direction} onChange={e=>change(r.id,{direction:e.target.value as "ingress" | "egress"})}><option>ingress</option><option>egress</option></select></label>
          {(["source","destination"] as const).map(k=><label key={k}>{k}<select value={r[k]} onChange={e=>change(r.id,{[k]:e.target.value})}><option value="any">any</option>{resources.filter(n=>n.type !== "Firewall").map(n=><option key={n.id} value={n.id}>{n.name || n.id} ({n.id})</option>)}</select></label>)}
          {(["fromPort","toPort"] as const).map(k=><label key={k}>{k === "fromPort" ? "First TCP port" : "Last TCP port"}<input type="number" min={1} max={65535} placeholder="Unknown" value={Number.isNaN(r[k]) ? "" : r[k]} onChange={e=>change(r.id,{[k]:e.target.value === "" ? NaN : Number(e.target.value)})} /></label>)}
          <label>Action<select value={r.action} onChange={e=>change(r.id,{action:e.target.value as "allow" | "deny"})}><option>allow</option><option>deny</option></select></label>
          <button type="button" onClick={()=>commit({rules:p.rules.filter(row=>row.id !== r.id)})}>Remove {r.id}</button>
        </fieldset>)}
        <button type="button" disabled={p.rules.length >= 32} onClick={add}>Add rule</button>
      </fieldset>}
    </> : <>
      <Switch label="Use explicit TCP listeners" checked={resource.listenerSettings !== undefined} disabled={disabled} onChange={enabled=>updateResource(resource.id,{listenerSettings:enabled ? {version:1,ports:[RESOURCE_PORTS[resource.type]]} : undefined})} />
      {resource.listenerSettings ? <ListenerEditor key={JSON.stringify(resource.listenerSettings)} resource={resource} disabled={disabled} /> : <p>Listeners are inferred from the service and saved connection ports.</p>}
    </>}
    {error && <p role="alert">{error}</p>}
    <SecurityReadings metrics={metrics} />
  </InspectorSection>;
}
