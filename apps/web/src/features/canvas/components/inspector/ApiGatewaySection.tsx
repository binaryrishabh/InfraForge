import { defaultApiRoutes, resolveApiGateway, type ApiGatewaySettings, type ApiRoute, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { useCanvasStore } from "../../store/canvasStore";
import { InspectorSection } from "./InspectorSection";
const fields = [["maxRequestBytes", "Maximum request bytes", 0, 1048576], ["maxInFlight", "Outstanding requests", 1, 10000], ["upstreamTimeoutMs", "Request timeout (ms)", 1, 60000]] as const;
export function ApiGatewaySection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const connections = useCanvasStore(s => s.connectionLines).filter(e => e.sourceId === resource.id);
  const settings = resource.apiGateway, defaults = resolveApiGateway(), routes = settings?.routes ?? defaultApiRoutes(connections);
  const update = (patch: Partial<ApiGatewaySettings>) => updateResource(resource.id, { apiGateway: { ...settings, version: 1, ...patch } });
  const route = (index: number, patch: Partial<ApiRoute>) => update({ routes: routes.map((r, i) => i === index ? { ...r, ...patch } : r) });
  const add = () => { let n = 1; while (routes.some(r => r.id === `route-${n}`)) n++; update({ routes: [...routes, { id: `route-${n}`, edge: connections[0]!.id, path: `/route-${n}`, method: "ANY" }] }); };
  return <InspectorSection title="Gateway routes">
    {fields.map(([key, label, min, max]) => <Field key={key} label={label}>{({ id }) => <Input id={id} type="number" step={1} min={min} max={max} disabled={disabled} placeholder={String(defaults[key])} value={settings?.[key] ?? ""} onChange={e => update({ [key]: e.target.value === "" ? undefined : Number(e.target.value) })} />}</Field>)}
    <fieldset disabled={disabled}>
      {routes.map((r, i) => <div key={r.id} className="mt-3">
        <Field label={`Path ${r.id}`}>{({ id }) => <Input id={id} maxLength={256} value={r.path} onChange={e => route(i, { path: e.target.value })} />}</Field>
        <label>Method <select aria-label={`Method ${r.id}`} value={r.method} onChange={e => route(i, { method: e.target.value as ApiRoute["method"] })}>{["GET", "POST", "ANY"].map(m => <option key={m}>{m}</option>)}</select></label>
        <label>Upstream <select aria-label={`Upstream ${r.id}`} value={r.edge} onChange={e => route(i, { edge: e.target.value })}>{connections.map(c => <option key={c.id} value={c.id}>{c.targetId}</option>)}</select></label>
        <Field label={`Burst requests ${r.id}`}>{({ id }) => <Input id={id} type="number" min={1} max={10000} step={1} value={r.burstRequests ?? ""} placeholder="100" onChange={e => route(i, { burstRequests: e.target.value === "" ? undefined : Number(e.target.value) })} />}</Field>
        <Field label={`Requests per second ${r.id}`}>{({ id }) => <Input id={id} type="number" min={1} max={10000} step={1} value={r.requestsPerSecond ?? ""} placeholder="1000" onChange={e => route(i, { requestsPerSecond: e.target.value === "" ? undefined : Number(e.target.value) })} />}</Field>
        <button type="button" disabled={routes.length <= 1} onClick={() => update({ routes: routes.filter((_, index) => index !== i) })}>Remove route</button>
      </div>)}
      <button type="button" disabled={!connections.length || routes.length >= 16} onClick={add}>Add route</button>
    </fieldset>
    <p className="text-xs text-ink-3">The workload sends GET /read and POST /write. Exact routes have independent budgets; invalid requests, missing routes, throttles and upstream failures are measured separately. Authentication is Unknown.</p>
  </InspectorSection>;
}
