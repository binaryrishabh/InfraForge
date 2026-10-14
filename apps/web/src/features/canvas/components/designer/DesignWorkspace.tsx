import { useState } from "react";
import { Dialog } from "@/ui/Dialog";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { ConfirmDialog } from "@/ui/ConfirmDialogs";
import { useChallengeBrief } from "@/features/challenges/useChallengeBrief";
import { useChallengePreflight } from "@/features/challenges/useChallengePreflight";
import { AttemptDialog } from "@/features/challenges/components/AttemptDialog";
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

/* Designer layout: one bar, a docked resource list, the drafting sheet in the
centre and a context column. Below the large breakpoint the list becomes a
sheet; below medium the context column does too. The canvas is never covered
by a permanent panel. */
const RAIL_KEY = "infraforge:palette-rail";
const readRail = () => { try { return localStorage.getItem(RAIL_KEY) === "1"; } catch { return false; } };

export function DesignWorkspace() {
  const route = useDesignRoute();
  const challengeId = useCanvasStore((s) => s.currentChallengeId);
  const selection = useCanvasStore((s) => s.selectedResourceForConfigId);
  const modal = useCanvasStore((s) => s.modalState);
  const brief = useChallengeBrief(challengeId);
  const preflight = useChallengePreflight(challengeId);
  const [tab, setTab] = useState<SideTab>(challengeId ? "brief" : "inspect");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const wide = useMediaQuery("(min-width: 768px)");
  const [railOnly, setRailOnly] = useState(readRail);
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
        <WorkspaceBar challengeTitle={title} onPalette={() => setPaletteOpen(true)} onPanel={() => setPanelOpen(true)} />
        <ImprovementNotice />
        <div className="relative flex min-h-0 flex-1">
          <aside className={`hidden shrink-0 border-r border-line bg-surface lg:block ${railOnly ? "w-14" : "w-64"}`}>
            {railOnly ? <PaletteRail onExpand={() => setRail(false)} /> : <PalettePanel onCollapse={() => setRail(true)} />}
          </aside>
          <main id="main" tabIndex={-1} className="relative flex min-w-0 flex-1 flex-col outline-none" aria-label="Design canvas">
            <CanvasBoard label={`Canvas for ${useCanvasStore.getState().currentLayoutName ?? "untitled design"}. Tab through resources; Enter inspects.`} />
            <CanvasEmptyState />
            {route.loading && <p role="status" className="absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-md border border-line bg-raised px-3 py-1.5 text-sm shadow-e2">Opening design…</p>}
          </main>
          <aside className="hidden w-[340px] shrink-0 border-l border-line bg-surface md:block" aria-label="Design details">{panel("side")}</aside>
        </div>
        <StatusBar onChecks={() => { setTab("checks"); if (!wide) setPanelOpen(true); }} />
      </div>

      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen} title="Add a resource" size="sm">
        <div className="-mx-5 -my-4 h-[60dvh]"><PalettePanel draggable={false} onAdded={() => setPaletteOpen(false)} /></div>
      </Dialog>
      {!wide && (
        <Dialog open={panelOpen} onOpenChange={setPanelOpen} title={tab === "brief" ? "Challenge brief" : tab === "checks" ? "Checks" : "Inspector"} size="md">
          <div className="-mx-5 -my-4 h-[70dvh]">{panel("sheet")}</div>
        </Dialog>
      )}

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
