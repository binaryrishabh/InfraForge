import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Undo2, Redo2, Save, Play, Lock } from "lucide-react";
import { errorMessage } from "@/api/errorMessage";
import { BrandMark } from "@/ui/Brand";
import { Button } from "@/ui/Button";
import { IconButton } from "@/ui/IconButton";
import { Tag } from "@/ui/Tag";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { useCanvasStore } from "../../store/canvasStore";
import { redo, undo } from "../../history";
import { requestRun, saveDesign } from "../../designActions";
import { DesignMenu } from "./DesignMenu";

async function save() {
  try { if (await saveDesign()) toast.success("Design saved"); }
  catch (error) { toast.error(errorMessage(error, "The design could not be saved.")); }
}

/* The designer's single bar: where you are, what this design is, its save state,
history, and the one primary action (run, or start a challenge attempt). */
export function WorkspaceBar({ challengeTitle }: { challengeTitle: string | null }) {
  const canUndo = useCanvasStore((s) => s.undoStack.length > 0);
  const canRedo = useCanvasStore((s) => s.redoStack.length > 0);
  const saved = useCanvasStore((s) => s.currentLayoutSaved);
  const hasId = useCanvasStore((s) => !!s.currentLayoutId);
  const empty = useCanvasStore((s) => s.resources.length === 0);
  const challenge = useCanvasStore((s) => s.currentChallengeId);
  const busy = useCanvasStore((s) => s.isDeploying);
  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-1 border-b border-line bg-surface px-2 sm:gap-2 sm:px-3">
      <Link to="/home" aria-label="InfraForge home" className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink hover:bg-sunken"><BrandMark size={20} /></Link>
      <span aria-hidden="true" className="h-6 w-px shrink-0 bg-line" />
      <DesignMenu />
      {challengeTitle && (
        <Tag tone="neutral" className="shrink-0 max-md:hidden" icon={<Lock size={11} aria-hidden="true" />}>
          <span className="max-w-[24ch] truncate">Challenge · {challengeTitle}</span>
        </Tag>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
        <IconButton label="Undo (Ctrl+Z)" icon={<Undo2 size={16} />} onClick={undo} disabled={!canUndo || busy} className="max-sm:hidden" />
        <IconButton label="Redo (Ctrl+Shift+Z)" icon={<Redo2 size={16} />} onClick={redo} disabled={!canRedo || busy} className="max-sm:hidden" />
        <Button variant="secondary" size="sm" className="max-sm:hidden" icon={<Save size={14} aria-hidden="true" />}
          onClick={() => void save()} disabled={busy || empty || (hasId && saved)}>{hasId && saved ? "Saved" : "Save"}</Button>
        <Button variant="primary" size="sm" onClick={requestRun} disabled={busy || empty} aria-label={challenge ? "Predict and run" : undefined}
          icon={challenge ? <Lock size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}>
          {challenge ? <><span className="hidden sm:inline">Predict and run</span><span className="sm:hidden">Run</span></> : "Run"}
        </Button>
        <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-line sm:block" />
        <div className="hidden sm:block"><AccountMenu compact /></div>
      </div>
    </header>
  );
}
