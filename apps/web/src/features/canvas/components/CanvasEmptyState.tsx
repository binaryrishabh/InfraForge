import { Link } from "react-router-dom";
import { useCanvasStore } from "../store/canvasStore";
import { loadSampleArchitecture } from "../designActions";
import { Button } from "@/ui/Button";

/* Shown on an empty freeform sheet. It sits in the middle of the canvas and
never blocks dropping or panning around it. */
export function CanvasEmptyState() {
  const empty = useCanvasStore((s) => s.resources.length === 0);
  const dismissed = useCanvasStore((s) => s.emptyCanvasStateDismissed);
  const challenge = useCanvasStore((s) => s.currentChallengeId);
  if (!empty || dismissed) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6">
      <div className="pointer-events-auto max-w-[400px] rounded-lg border border-line bg-raised/95 px-6 py-5 shadow-e2">
        <p className="if-eyebrow">{challenge ? "Blank challenge sheet" : "Empty sheet"}</p>
        <h2 className="if-title mt-1.5 text-[22px] text-ink">Start with the entry point.</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          Add DNS, then a load balancer and app servers, and connect them in the direction traffic flows. Choose a resource from the
          resource list to place it in view, or drag it onto the sheet.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {!challenge && <Button variant="secondary" size="sm" onClick={loadSampleArchitecture}>Load a sample design</Button>}
          {!challenge && <Link to="/challenges" className="inline-flex h-8 items-center rounded-md px-2.5 text-[13px] font-medium text-accent hover:underline">Or pick a challenge</Link>}
          <Button variant="ghost" size="sm" onClick={() => useCanvasStore.getState().setEmptyCanvasStateDismissed(true)}>Dismiss</Button>
        </div>
      </div>
    </div>
  );
}
