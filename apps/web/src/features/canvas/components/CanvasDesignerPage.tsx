import { useCanvasPersistence } from "../hooks/useCanvasPersistence";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { reenterRun } from "@/features/live/reenterRun";
import { Notice } from "@/ui/Page";
import { useCanvasStore } from "../store/canvasStore";
import { SkipLink } from "@/components/shell/AppShell";
const DesignWorkspace = lazy(() => import("./designer/DesignWorkspace").then((m) => ({ default: m.DesignWorkspace })));
const LiveWorkspace = lazy(() => import("@/features/live/LiveWorkspace").then((m) => ({ default: m.LiveWorkspace })));

function OpenRun({ id }: { id: string }) {
  const navigate = useNavigate();
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void reenterRun(id, undefined, controller.signal).then(() => {
      if (!controller.signal.aborted) navigate("/design", { replace: true });
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [id, navigate]);
  return error ? <Notice tone="fail" role="alert" className="m-6">This run could not be opened. It may have stopped or your session may have ended. <Link className="underline" to={`/runs/${id}`}>Open the report</Link></Notice>
    : <p role="status" className="p-6 text-sm">Opening live run…</p>;
}

// Both workspaces adapt to the window: panels dock when there is room and open as sheets when there is not.
export function CanvasDesignerPage() {
  useCanvasPersistence();
  const activeRun = useCanvasStore((s) => s.activeDeploymentId);
  const [params] = useSearchParams();
  const requestedRun = params.get("run");
  return (
    <>
      <SkipLink />
      <Suspense fallback={<p role="status" className="p-6 text-sm">Opening workspace…</p>}>
        {requestedRun ? <OpenRun key={requestedRun} id={requestedRun} /> : activeRun ? <LiveWorkspace key={activeRun} deploymentId={activeRun} /> : <DesignWorkspace />}
      </Suspense>
    </>
  );
}
