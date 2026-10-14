import { useState } from "react";
import { toast } from "sonner";
import { findSku, skusFor } from "@infraforge/catalog";
import { PROVIDERS, type ProviderId, type SkuCategory } from "@infraforge/catalog/types";
import { RESOURCE_TYPES, type Resource } from "@infraforge/domain/resource";
import { scaleVertical } from "@/api/deployment.api";
import { errorMessage } from "@/api/errorMessage";
import { Button } from "@/ui/Button";
import { Field, Select } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { ControlBlock } from "./ControlBlock";

/* Swap an app server or database to another catalog size. The resource is
offline while it restarts on the new size. */
export function ResizeControl({ deploymentId, resources, fixedTarget }: { deploymentId: string; resources: Resource[]; fixedTarget?: string }) {
  const sizeable = resources.filter((r) => r.type === RESOURCE_TYPES.VirtualMachine || r.type === RESOURCE_TYPES.Database);
  const [requested, setRequested] = useState("");
  const target = sizeable.find((r) => r.id === (fixedTarget ?? requested)) ?? sizeable[0];
  if (!target) return null;
  return <Resize key={target.id} deploymentId={deploymentId} target={target} choices={fixedTarget ? null : sizeable} onTarget={setRequested} />;
}

function Resize({ deploymentId, target, choices, onTarget }: { deploymentId: string; target: Resource; choices: Resource[] | null; onTarget: (id: string) => void }) {
  const [provider, setProvider] = useState<ProviderId>(() => (target.skuId && findSku(target.skuId)?.provider) || "aws");
  const [sku, setSku] = useState("");
  const [busy, setBusy] = useState(false);
  const category: SkuCategory = target.type === RESOURCE_TYPES.Database ? "Database" : "Virtual Machine";
  const resize = async () => {
    setBusy(true);
    try { await scaleVertical(deploymentId, target.id, sku); toast.info(`Resize of ${target.name || target.id} requested`); }
    catch (error) { toast.error(errorMessage(error, "The resize could not be requested.")); }
    finally { setBusy(false); }
  };
  return (
    <ControlBlock title="Resize" aside={`now ${target.skuId ?? "generic"}`}>
      <div className="flex flex-col gap-2">
        {choices && (
          <Field label="Resource">{({ id }) => (
            <Select id={id} value={target.id} onChange={(e) => onTarget(e.target.value)}>{choices.map((r) => <option key={r.id} value={r.id}>{r.name || r.id} ({r.type})</option>)}</Select>
          )}</Field>
        )}
        <Segmented label="Provider" size="sm" value={provider} onChange={(v) => { setProvider(v); setSku(""); }}
          options={(Object.keys(PROVIDERS) as ProviderId[]).map((id) => ({ value: id, label: id === "aws" ? "AWS" : "DigitalOcean" }))} />
        <Field label="New size" hint="The resource restarts and serves no traffic until the new size is online.">{({ id, describedBy }) => (
          <Select id={id} aria-describedby={describedBy} value={sku} onChange={(e) => setSku(e.target.value)}>
            <option value="">Choose a size…</option>
            {skusFor(provider, category).map((s) => <option key={s.skuId} value={s.skuId} disabled={s.skuId === target.skuId}>{s.label} · ${s.monthlyPriceUsd}/mo</option>)}
          </Select>
        )}</Field>
        <Button variant="secondary" size="sm" loading={busy} disabled={!sku} onClick={() => void resize()}>Resize</Button>
      </div>
    </ControlBlock>
  );
}
