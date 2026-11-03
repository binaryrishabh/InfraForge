import { useState } from "react";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import type { Resource } from "@infraforge/domain/resource";
import { injectChaos } from "@/api/deployment.api";
import { errorMessage } from "@/api/errorMessage";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { Button } from "@/ui/Button";
import { liveGuide, type LiveGuide } from "./liveGuide";

export function LiveGuideView({ guide, busy, onCrash }: { guide: LiveGuide; busy: boolean; onCrash: (id: string) => void }) {
  return (
    <section aria-label="What to try next" aria-live="polite" className="border-b border-line bg-surface px-4 py-3 text-sm">
      <p className="font-semibold text-ink">{guide.title}</p>
      <p className="mt-1 text-ink-2">{guide.body}</p>
      {guide.stage === "break" && guide.target && (
        <Button className="mt-2" size="sm" variant="secondary" loading={busy} icon={<Zap size={14} aria-hidden="true" />} onClick={() => onCrash(guide.target!.id)}>{guide.target.label}</Button>
      )}
    </section>
  );
}

/* A learner's next step, taken from what this run has measured. It appears while a freeform run is live. */
export function LiveGuidePanel({ deploymentId, resources }: { deploymentId: string; resources: Resource[] }) {
  const metrics = useSimulationStore((s) => s.metrics);
  const activeChaos = useSimulationStore((s) => s.activeChaos);
  const simulatedSeconds = useSimulationStore((s) => s.simulatedSeconds);
  const [busy, setBusy] = useState(false);
  // Held in the store, so the panel and the phone banner agree even when one replaces the other.
  const faultSeen = useSimulationStore((s) => s.faultSeen);
  const guide = liveGuide({ resources, metrics, activeChaos, faultSeen, simulatedSeconds });
  if (!guide) return null;
  const crash = async (id: string) => {
    setBusy(true);
    try { await injectChaos(deploymentId, "crash", id); toast.info(`Crash requested on ${id}`); }
    catch (error) { toast.error(errorMessage(error, "The fault could not be applied.")); }
    finally { setBusy(false); }
  };
  return <LiveGuideView guide={guide} busy={busy} onCrash={(id) => void crash(id)} />;
}
