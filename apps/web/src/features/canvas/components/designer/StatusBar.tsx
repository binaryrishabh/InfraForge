import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { StatusMark } from "@/ui/StatusMark";
import { Kbd } from "@/ui/Page";
import { useCanvasStore } from "../../store/canvasStore";
import { ZoomControls } from "../ZoomControls";

/* Bottom rule of the sheet: counts, readiness, what is selected and how to act
on it with the keyboard, and zoom. */
export function StatusBar({ onChecks }: { onChecks: () => void }) {
  const resources = useCanvasStore((s) => s.resources);
  const lines = useCanvasStore((s) => s.connectionLines);
  const selected = useCanvasStore((s) => s.resources.find((r) => r.id === s.selectedResourceId));
  const connection = useCanvasStore((s) => s.selectedConnectionId);
  const readiness = validateDeploymentReadiness(resources, lines);
  return (
    <footer className="flex h-10 shrink-0 items-center gap-3 border-t border-line bg-surface px-3 text-xs text-ink-2">
      <span className="if-num whitespace-nowrap">{resources.length} {resources.length === 1 ? "resource" : "resources"} · {lines.length} {lines.length === 1 ? "link" : "links"}</span>
      {resources.length > 0 && (
        <button type="button" onClick={onChecks} className="hidden rounded-sm hover:underline sm:inline-flex">
          <StatusMark size="sm" kind={readiness.valid ? "ok" : "problem"} label={readiness.valid ? "Ready to run" : `${readiness.errors.length} to fix`} />
        </button>
      )}
      <p className="hidden min-w-0 flex-1 truncate text-ink-3 lg:block" aria-live="polite">
        {selected ? <>Selected <span className="font-semibold text-ink">{selected.name || selected.id}</span> · <Kbd>←↑→↓</Kbd> move · <Kbd>Del</Kbd> remove · <Kbd>Esc</Kbd> clear</>
          : connection ? <>Link selected · <Kbd>Del</Kbd> removes it</> : <>Drag empty space to pan · scroll to zoom · drag from a card edge to connect</>}
      </p>
      <div className="ml-auto"><ZoomControls /></div>
    </footer>
  );
}
