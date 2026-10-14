import { useSearchParams } from "react-router-dom";
import { PanelsTopLeft } from "lucide-react";
import { Wordmark } from "@/ui/Brand";
import { ButtonLink } from "@/ui/Button";
import { useCanvasStore } from "../store/canvasStore";
import { DESIGNER_MIN_WIDTH } from "../designerViewport";

export function WorkspaceRequired() {
  const [params] = useSearchParams();
  const challenge = useCanvasStore((s) => s.currentChallengeId);
  const unsaved = useCanvasStore((s) => !s.currentLayoutSaved && s.resources.length > 0);
  const design = useCanvasStore((s) => s.currentLayoutName);
  const activeRun = useCanvasStore((s) => s.activeDeploymentId);
  const requested = params.has("design");
  return <div className="flex min-h-dvh flex-col bg-bg px-5 py-7 text-ink sm:px-10">
    <header><Wordmark /></header>
    <main id="main" tabIndex={-1} className="my-auto w-full max-w-lg self-center py-12 outline-none">
      <div aria-hidden="true" className="mb-6 flex size-12 items-center justify-center rounded-lg border border-line bg-surface text-accent"><PanelsTopLeft size={24} /></div>
      <p className="if-eyebrow">Architecture workspace</p>
      <h1 className="if-display mt-3 text-[32px] leading-tight sm:text-[40px]">Give your design more room.</h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-2">Placing resources and tracing connections needs space for precise work. Use a laptop or desktop, or widen this window to at least {DESIGNER_MIN_WIDTH}px.</p>
      <p role="status" className="mt-4 text-sm text-ink-3">{activeRun ? "Your run stays on the server. Widen the window to return to its architecture workspace, or open its report." : unsaved ? `Your unsaved ${design ?? "design"} stays here when you widen the window.` : requested ? "Your requested design will open when the workspace has enough room." : "Your workspace stays available when you widen the window."}</p>
      <nav aria-label="Continue outside the Designer" className="mt-7 flex flex-wrap gap-3">
        <ButtonLink to={challenge ? `/challenges/${challenge}` : "/designs"}>{challenge ? "Back to challenge" : "Back to Designs"}</ButtonLink>
        <ButtonLink variant="secondary" to={activeRun ? `/runs/${activeRun}` : "/runs"}>{activeRun ? "View run report" : "View Runs"}</ButtonLink>
      </nav>
    </main>
  </div>;
}
