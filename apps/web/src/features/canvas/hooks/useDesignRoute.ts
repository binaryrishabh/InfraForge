import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { getSpecificInfrastructure } from "@/api/infrastructure.api";
import { useCanvasStore } from "../store/canvasStore";
import { installDesign } from "../designLoader";
import { refreshDesignIdentity } from "../designIdentity";

/* `/design?design=<id>` is a request to open a saved design. It stays in the
URL while the design loads and is removed once handled. A request that would
discard unsaved work waits for the person to decide. Nothing is decided until the
local draft has been restored: on a fresh page load an empty canvas is not yet
known to be empty. */
export function useDesignRoute() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("design");
  const ready = useCanvasStore((s) => s.isInitialized);
  const currentId = useCanvasStore((s) => s.currentLayoutId);
  const live = useCanvasStore((s) => !!s.activeDeploymentId);
  const unsaved = useCanvasStore((s) => !s.currentLayoutSaved && s.resources.length > 0);
  const consume = () => setParams((prev) => { const next = new URLSearchParams(prev); next.delete("design"); return next; }, { replace: true });
  const pending = requested && ready && !live && requested !== currentId && unsaved ? requested : null;
  const open = (id: string) => getSpecificInfrastructure(id).then(installDesign)
    .catch(() => toast.error("That design could not be opened. It may have been deleted."))
    .finally(consume);
  useEffect(() => {
    if (!requested || !ready || pending) return;
    if (live) { toast.info("Leave the current run before opening another design."); consume(); return; }
    if (requested === currentId) {
      void refreshDesignIdentity(requested).catch(() => toast.error("That design's challenge identity could not be checked.")).finally(consume);
      return;
    }
    void open(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per request
  }, [requested, ready, pending]);
  return {
    loading: !!requested && !pending && !live,
    pending,
    confirm: () => { if (pending) void open(pending); },
    cancel: consume,
  };
}
