import { useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { validateConnection } from "@infraforge/domain/validation";
import type { Resource } from "@infraforge/domain/resource";
import { Button } from "@/ui/Button";
import { IconButton } from "@/ui/IconButton";
import { Select } from "@/ui/Field";
import { useCanvasStore } from "../../store/canvasStore";
import { connectResources, deleteConnection } from "../../actions";
import { InspectorSection } from "./InspectorSection";

/* Keyboard-complete wiring: every connection is listed with a remove control,
and "Connect to" offers only targets the connection rules allow. */
export function ConnectionsSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const resources = useCanvasStore((s) => s.resources);
  const lines = useCanvasStore((s) => s.connectionLines);
  const [target, setTarget] = useState("");
  const [said, setSaid] = useState("");
  const box = useRef<HTMLDivElement>(null);
  // The control that was used may disappear with the change; keep focus inside the section.
  const settle = (message: string) => {
    setSaid(message);
    setTimeout(() => (box.current?.querySelector<HTMLElement>(`#connect-${CSS.escape(resource.id)}`) ?? box.current)?.focus(), 0);
  };
  const name = (id: string) => { const r = resources.find((x) => x.id === id); return r ? r.name || r.id : id; };
  const outgoing = lines.filter((l) => l.sourceId === resource.id);
  const incoming = lines.filter((l) => l.targetId === resource.id);
  const candidates = resources.filter((r) => r.id !== resource.id && !outgoing.some((l) => l.targetId === r.id) && validateConnection(resource.type, r.type).valid);
  const chosen = candidates.some((c) => c.id === target) ? target : "";
  const row = (id: string, label: string, other: string, direction: "to" | "from", port: number) => (
    <li key={id} className="flex items-center gap-2 py-1">
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
        <span className="text-ink-3">{direction === "to" ? "To" : "From"}</span> {other} <span className="if-num text-xs text-ink-3">:{port}</span>
      </span>
      {!disabled && <IconButton size="sm" label={`Remove connection ${label}`} icon={<X size={14} />} onClick={() => { deleteConnection(id); settle(`Removed connection ${label}.`); }} />}
    </li>
  );
  return (
    <InspectorSection title="Connections">
      <div ref={box} tabIndex={-1} className="outline-none">
        {outgoing.length + incoming.length === 0 ? <p className="text-sm text-ink-3">Not connected yet.</p> : (
          <ul className="divide-y divide-line">
            {outgoing.map((l) => row(l.id, `to ${name(l.targetId)}`, name(l.targetId), "to", l.port))}
            {incoming.map((l) => row(l.id, `from ${name(l.sourceId)}`, name(l.sourceId), "from", l.port))}
          </ul>
        )}
        {!disabled && (
          candidates.length > 0 ? (
            <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (chosen && connectResources(resource.id, chosen)) { setTarget(""); settle(`Connected ${resource.name || resource.id} to ${name(chosen)}.`); } }}>
              <label className="sr-only" htmlFor={`connect-${resource.id}`}>Connect {resource.name || resource.id} to</label>
              <Select id={`connect-${resource.id}`} value={chosen} onChange={(event) => setTarget(event.target.value)} className="min-w-0 flex-1">
                <option value="">Connect to…</option>
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.name || c.id} ({c.type})</option>)}
              </Select>
              <Button type="submit" size="md" disabled={!chosen} icon={<ArrowRight size={14} aria-hidden="true" />}>Connect</Button>
            </form>
          ) : <p className="mt-3 text-xs text-ink-3">No other resource on the canvas can receive a connection from a {resource.type}.</p>
        )}
        <p role="status" className="sr-only">{said}</p>
      </div>
    </InspectorSection>
  );
}
