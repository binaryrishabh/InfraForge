import { useState } from "react";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import type { Resource } from "@infraforge/domain/resource";
import { injectChaos } from "@/api/deployment.api";
import { errorMessage } from "@/api/errorMessage";
import { Button } from "@/ui/Button";
import { Field, Select } from "@/ui/Field";
import { FAULTS } from "../faults";
import { ControlBlock } from "./ControlBlock";

/* Inject one fault into one resource. A request is recorded first; its effect
appears once the simulator applies it. */
export function FaultControl({ deploymentId, resources, fixedTarget }: { deploymentId: string; resources: Resource[]; fixedTarget?: string }) {
  const [requested, setRequested] = useState("");
  const target = fixedTarget ?? (resources.some((r) => r.id === requested) ? requested : resources[0]?.id ?? "");
  const [fault, setFault] = useState(FAULTS[0]!.id);
  const [busy, setBusy] = useState(false);
  const chosen = FAULTS.find((f) => f.id === fault)!;
  const inject = async () => {
    setBusy(true);
    try { await injectChaos(deploymentId, fault, target); toast.info(`${chosen.label} requested on ${target}`); }
    catch (error) { toast.error(errorMessage(error, "The fault could not be requested.")); }
    finally { setBusy(false); }
  };
  return (
    <ControlBlock title="Inject a fault" aside={`${chosen.seconds} s`}>
      <div className="flex flex-col gap-2">
        {!fixedTarget && (
          <Field label="Resource">{({ id }) => (
            <Select id={id} value={target} onChange={(e) => setRequested(e.target.value)}>{resources.map((r) => <option key={r.id} value={r.id}>{r.name || r.id} ({r.type})</option>)}</Select>
          )}</Field>
        )}
        <Field label="Fault" hint={chosen.effect}>{({ id, describedBy }) => (
          <Select id={id} aria-describedby={describedBy} value={fault} onChange={(e) => setFault(e.target.value as typeof fault)}>{FAULTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select>
        )}</Field>
        <Button variant="secondary" size="sm" icon={<Zap size={14} aria-hidden="true" />} loading={busy} disabled={!target} onClick={() => void inject()}>Inject {chosen.label.toLowerCase()}</Button>
      </div>
    </ControlBlock>
  );
}
