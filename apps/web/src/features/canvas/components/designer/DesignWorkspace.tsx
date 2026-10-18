import { useEffect, useState } from "react";
import { PanelRight, Plus } from "lucide-react";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { useCanvasKeyboardShortcuts } from "../../hooks/useCanvasKeyboardShortcuts";
import { ConfirmDialog } from "@/ui/ConfirmDialogs";
import { useChallengeBrief } from "@/features/challenges/useChallengeBrief";
import { useChallengePreflight } from "@/features/challenges/useChallengePreflight";
import { AttemptDialog } from "@/features/challenges/components/AttemptDialog";
import { useExperimentPlan } from "@/features/challenges/experimentPlanStore";
import { planOf } from "@/features/challenges/experiment";
import { useCanvasStore } from "../../store/canvasStore";
import { useDesignRoute } from "../../hooks/useDesignRoute";
import { CanvasDnd } from "../CanvasDnd";
import { CanvasBoard } from "../CanvasBoard";
import { CanvasEmptyState } from "../CanvasEmptyState";
import { DesignDialogs } from "../DesignDialogs";
import { PalettePanel } from "../palette/PalettePanel";
import { PaletteRail } from "../palette/PaletteRail";
import { WorkspaceBar } from "./WorkspaceBar";
import { SidePanel, type SideTab } from "./SidePanel";
import { StatusBar } from "./StatusBar";
import { ImprovementNotice } from "./ImprovementNotice";
import { LearningContextNotice } from "@/features/challenges/components/LearningContextNotice";
import { useChallengeImprovement } from "@/features/challenges/learningContext";

/* One Designer at every width. With room for all three, the palette, drafting sheet and
details sit side by side. Narrower, the palette folds to a rail and details open as a
sheet; on a phone both open as sheets so the drafting sheet keeps the whole screen. */
const RAIL_KEY = "infraforge:palette-rail";
const readRail = () => { try { return localStorage.getItem(RAIL_KEY) === "1"; } catch { return false; } };

export function DesignWorkspace() {
  useCanvasKeyboardShortcuts();
  const route = useDesignRoute();
  const challengeId = useCanvasStore((s) => s.currentChallengeId);
  const selection = useCanvasStore((s) => s.selectedResourceForConfigId);
  const modal = useCanvasStore((s) => s.modalState);
  const learning = useChallengeImprovement();
  const brief = useChallengeBrief(challengeId, learning?.version);
  // The experiment's target is marked on its card while designing.
  const experiment = brief?.data?.experiment ?? null;
  const experimentKey = experiment ? JSON.stringify(experiment) : null;
  useEffect(() => {
    useExperimentPlan.getState().setPlan(experimentKey ? planOf(JSON.parse(experimentKey)) : null);
    return () => useExperimentPlan.getState().setPlan(null);
  }, [experimentKey]);
  const preflight = useChallengePreflight(challengeId, learning?.version);
  const [tab, setTab] = useState<SideTab>(selection ? "inspect" : challengeId ? "brief" : "inspect");
  const [railOnly, setRailOnly] = useState(readRail);
  const docked = useMediaQuery("(min-width: 1100px)"), roomy = useMediaQuery("(min-width: 640px)");
  const [sheet, setSheet] = useState<"add" | "details" | null>(null);
  const setRail = (value: boolean) => { setRailOnly(value); try { localStorage.setItem(RAIL_KEY, value ? "1" : "0"); } catch { /* storage unavailable */ } };

  // A new selection brings the inspector forward; entering a challenge brings the brief forward.
  const [seen, setSeen] = useState({ selection, challengeId });
  if (seen.selection !== selection || seen.challengeId !== challengeId) {
    if (seen.challengeId !== challengeId) setTab(challengeId ? "brief" : "inspect");
    else if (selection) setTab("inspect");
    setSeen({ selection, challengeId });
  }

  const title = brief?.data?.title ?? null;
  const panel = (base: string) => <SidePanel idBase={base} tab={tab} onTab={setTab} brief={brief} preflight={preflight.data} preflightError={preflight.error} />;
  return (
    <CanvasDnd>
      <div className="flex h-dvh flex-col overflow-hidden bg-bg text-ink">
        <WorkspaceBar challengeTitle={title} />
        <ImprovementNotice />
        <LearningContextNotice />
        <div className="relative flex min-h-0 flex-1">
          {roomy && (
            <aside className={`shrink-0 border-r border-line bg-surface ${railOnly || !docked ? "w-14" : "w-64"}`}>
              {railOnly || !docked ? <PaletteRail onExpand={docked ? () => setRail(false) : () => setSheet("add")} /> : <PalettePanel onCollapse={() => setRail(true)} />}
            </aside>
          )}
          <main id="main" tabIndex={-1} className="relative flex min-w-0 flex-1 flex-col outline-none" aria-label="Design canvas">
            <CanvasBoard label={`Canvas for ${useCanvasStore.getState().currentLayoutName ?? "untitled design"}. Tab through resources; Enter inspects.`} />
            <CanvasEmptyState />
            {route.loading && <p role="status" className="absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-md border border-line bg-raised px-3 py-1.5 text-sm shadow-e2">Opening design…</p>}
            {!docked && (
              <div className="absolute top-3 right-3 z-20 flex gap-2">
                {!roomy && <Button size="sm" variant="secondary" className="bg-surface" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setSheet("add")}>Add</Button>}
                <Button size="sm" variant="secondary" className="bg-surface" icon={<PanelRight size={14} aria-hidden="true" />} onClick={() => setSheet("details")}>
                  {selection ? "Inspect" : challengeId ? "Brief" : "Details"}
                </Button>
              </div>
            )}
          </main>
          {docked && <aside className="w-[340px] shrink-0 border-l border-line bg-surface" aria-label="Design details">{panel("side")}</aside>}
        </div>
        <StatusBar onChecks={() => setTab("checks")} />
      </div>

      {!docked && <>
        <Dialog open={sheet === "add"} onOpenChange={(open) => setSheet(open ? "add" : null)} title="Add a resource" size="md">
          <div className="-mx-5 -my-4 h-[60dvh]"><PalettePanel draggable={false} onAdded={() => setSheet(null)} /></div>
        </Dialog>
        <Dialog open={sheet === "details"} onOpenChange={(open) => setSheet(open ? "details" : null)} title="Design details" size="md">
          <div className="-mx-5 -my-4 h-[70dvh]">{panel("sheet")}</div>
        </Dialog>
      </>}
      <DesignDialogs />
      {brief?.data && modal?.type === "attempt" && (
        <AttemptDialog brief={brief.data} preflight={preflight.data} open onOpenChange={(open) => { if (!open) useCanvasStore.getState().setModalState(null); }} />
      )}
      <ConfirmDialog open={!!route.pending} onOpenChange={(open) => { if (!open) route.cancel(); }} danger title="Open another design?"
        description={`${useCanvasStore.getState().currentLayoutName ?? "The current canvas"} has changes that are not saved.`}
        consequences={["Opening the other design replaces the canvas; those changes are lost.", "Cancel, then save, to keep them."]}
        confirmLabel="Discard and open" onConfirm={route.confirm} />
    </CanvasDnd>
  );
}
