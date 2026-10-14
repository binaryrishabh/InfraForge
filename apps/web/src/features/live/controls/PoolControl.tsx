import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import type { PoolSnapshot } from "@infraforge/contracts/telemetry";
import { scalePool } from "@/api/deployment.api";
import { errorMessage } from "@/api/errorMessage";
import { IconButton } from "@/ui/IconButton";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { ControlBlock } from "./ControlBlock";

function PoolRow({ deploymentId, pool }: { deploymentId: string; pool: PoolSnapshot }) {
  const [busy, setBusy] = useState(false);
  const change = async (delta: 1 | -1) => {
    setBusy(true);
    try { await scalePool(deploymentId, pool.lbId, delta); }
    catch (error) { toast.error(errorMessage(error, "The pool could not be scaled.")); }
    finally { setBusy(false); }
  };
  const pending = pool.pending !== null;
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{pool.lbId}</p>
        <p className="if-num text-[11px] text-ink-3">{pool.baseVmIds.length} placed · range {pool.minReplicas}–{pool.maxReplicas} · target {pool.targetCpu}%</p>
        {pool.pending && <p className="if-num text-[11px] text-warn">{pool.pending.action === "up" ? "Adding a replica" : "Draining a replica"} · {pool.pending.secondsRemaining} s</p>}
      </div>
      <IconButton size="sm" label={`Remove a replica from ${pool.lbId}`} icon={<Minus size={14} />} onClick={() => void change(-1)}
        disabled={busy || pending || pool.currentReplicas <= pool.minReplicas || pool.currentReplicas <= pool.baseVmIds.length} />
      <span className="if-num w-6 text-center text-sm text-ink" aria-label={`${pool.currentReplicas} active app servers`}>{pool.currentReplicas}</span>
      <IconButton size="sm" label={`Add a replica to ${pool.lbId}`} icon={<Plus size={14} />} onClick={() => void change(1)}
        disabled={busy || pending || pool.currentReplicas >= pool.maxReplicas} />
    </li>
  );
}

/* Manual pool scaling. Placed servers are never removed; one change at a time. */
export function PoolControl({ deploymentId, only }: { deploymentId: string; only?: string }) {
  const pools = useSimulationStore((s) => s.pools);
  const list = Object.values(pools).filter((p) => !only || p.lbId === only).sort((a, b) => a.lbId.localeCompare(b.lbId));
  if (!list.length) return only ? null : (
    <ControlBlock title="Pools"><p className="text-sm text-ink-3">No autoscaling pool. Pools form when app servers sit behind a load balancer with autoscaling on.</p></ControlBlock>
  );
  return (
    <ControlBlock title="Pools" aside="active app servers">
      <ul className="divide-y divide-line">{list.map((pool) => <PoolRow key={pool.lbId} deploymentId={deploymentId} pool={pool} />)}</ul>
      <p className="mt-2 text-xs text-ink-3">A manual change takes the same provisioning or draining time as the autoscaler. Placed servers are never removed.</p>
    </ControlBlock>
  );
}
