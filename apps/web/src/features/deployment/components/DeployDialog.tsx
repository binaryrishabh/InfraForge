import { useState, type FormEvent } from "react";
import { Play } from "lucide-react";
import type { WorkloadProfile } from "@infraforge/domain/workload";
import { INFRASTRUCTURE_NAME_MAX_LENGTH, validateInfrastructureName } from "@infraforge/domain/validation";
import { describeWorkload, requestsPerSecond, plural } from "@/lib/format";
import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { Field, Input } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { cx } from "@/ui/cx";

interface Preset { id: string; label: string; profile: Required<WorkloadProfile> }
const PRESETS: Preset[] = [
  { id: "steady", label: "Steady", profile: { targetThroughput: 1_000_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.8, payloadSize: "medium" } },
  { id: "peak", label: "Peak hours", profile: { targetThroughput: 1_000_000, throughputUnit: "per-hour", trafficShape: "peak", peakMultiplier: 3, readWriteRatio: 0.8, payloadSize: "medium" } },
  { id: "sale", label: "Flash sale", profile: { targetThroughput: 2_000_000, throughputUnit: "per-hour", trafficShape: "peak", peakMultiplier: 5, readWriteRatio: 0.9, payloadSize: "heavy" } },
  { id: "bots", label: "Bot traffic", profile: { targetThroughput: 3_000_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.95, payloadSize: "light" } },
  { id: "writes", label: "Write-heavy", profile: { targetThroughput: 1_000_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.3, payloadSize: "medium" } },
];

/* Freeform run: name the design and choose the traffic it faces. The run
captures this canvas, this workload and a fresh seed. */
export function DeployDialog({ open, onOpenChange, initialName, resourceCount, connectionCount, loading, onRun }: {
  open: boolean; onOpenChange: (open: boolean) => void; initialName: string; resourceCount: number; connectionCount: number; loading: boolean;
  onRun: (profile: WorkloadProfile, name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [touched, setTouched] = useState(false);
  const [profile, setProfile] = useState<Required<WorkloadProfile>>(PRESETS[0]!.profile);
  const preset = PRESETS.find((p) => JSON.stringify(p.profile) === JSON.stringify(profile));
  const nameError = touched ? validateInfrastructureName(name) : null;
  const patch = (next: Partial<WorkloadProfile>) => setProfile((prev) => ({ ...prev, ...next }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (validateInfrastructureName(name) || !(profile.targetThroughput > 0)) return;
    onRun({ ...profile, peakMultiplier: profile.trafficShape === "peak" ? profile.peakMultiplier : undefined }, name.trim());
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={loading} guarded size="lg" title="Run this design"
      description={`${plural(resourceCount, "resource")} and ${plural(connectionCount, "connection")}. The canvas is saved under this name, then a run starts with the traffic below.`}
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
        <Button type="submit" form="deploy-form" variant="primary" loading={loading} icon={<Play size={14} aria-hidden="true" />}>Save and run</Button>
      </>}>
      <form id="deploy-form" onSubmit={submit} className="flex flex-col gap-5">
        <Field label="Design name" error={nameError}>
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} autoFocus value={name} maxLength={INFRASTRUCTURE_NAME_MAX_LENGTH}
            onChange={(e) => setName(e.target.value)} onBlur={() => setTouched(true)} placeholder="checkout-api" />}
        </Field>
        <fieldset>
          <legend className="text-[13px] font-medium text-ink-2">Traffic</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {PRESETS.map((p) => (
              <label key={p.id} className={cx("flex cursor-pointer gap-2.5 rounded-md border px-3 py-2.5 transition-colors", preset?.id === p.id ? "border-ink bg-surface" : "border-line-strong hover:border-ink-3")}>
                <input type="radio" name="preset" checked={preset?.id === p.id} onChange={() => setProfile(p.profile)} className="mt-1 accent-[var(--if-ink)]" />
                <span><span className="block text-sm font-semibold text-ink">{p.label}</span><span className="block text-xs text-ink-3">{describeWorkload(p.profile)}</span></span>
              </label>
            ))}
          </div>
          {!preset && <p className="mt-2 text-xs text-ink-3">Custom: {describeWorkload(profile)}</p>}
        </fieldset>
        <details className="rounded-md border border-line px-4 py-2.5">
          <summary className="text-sm font-medium text-ink">Adjust the workload</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Requests" hint={`About ${Math.round(requestsPerSecond(profile)).toLocaleString()} per second at full load.`}>
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} value={profile.targetThroughput} onChange={(e) => patch({ targetThroughput: Number(e.target.value) })} />}
            </Field>
            <div className="flex flex-col gap-1.5"><span className="text-[13px] font-medium text-ink-2">Per</span>
              <Segmented label="Throughput unit" value={profile.throughputUnit} onChange={(v) => patch({ throughputUnit: v })} options={[{ value: "per-hour", label: "Hour" }, { value: "per-minute", label: "Minute" }]} /></div>
            <div className="flex flex-col gap-1.5"><span className="text-[13px] font-medium text-ink-2">Shape</span>
              <Segmented label="Traffic shape" value={profile.trafficShape} onChange={(v) => patch({ trafficShape: v })} options={[{ value: "steady", label: "Steady" }, { value: "peak", label: "Bursts" }]} /></div>
            {profile.trafficShape === "peak" && (
              <Field label="Burst multiplier" hint="Bursts arrive every 120 simulated seconds and last 20.">
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={10} step={0.5} value={profile.peakMultiplier} onChange={(e) => patch({ peakMultiplier: Number(e.target.value) })} />}
              </Field>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reads" className="text-[13px] font-medium text-ink-2">Reads: <span className="if-num">{Math.round(profile.readWriteRatio * 100)}%</span></label>
              <input id="reads" type="range" min={0} max={100} value={Math.round(profile.readWriteRatio * 100)} onChange={(e) => patch({ readWriteRatio: Number(e.target.value) / 100 })} className="accent-[var(--if-ink)]" />
            </div>
            <div className="flex flex-col gap-1.5"><span className="text-[13px] font-medium text-ink-2">Payload</span>
              <Segmented label="Payload size" value={profile.payloadSize} onChange={(v) => patch({ payloadSize: v })} options={[{ value: "light", label: "Light" }, { value: "medium", label: "Medium" }, { value: "heavy", label: "Heavy" }]} /></div>
          </div>
        </details>
      </form>
    </Dialog>
  );
}
