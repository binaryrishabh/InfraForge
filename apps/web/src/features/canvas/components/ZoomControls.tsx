import { Minus, Plus, Scan } from "lucide-react";
import { useCanvasStore } from "../store/canvasStore";
import { MIN_SCALE, MAX_SCALE, fitCanvasView, zoomIn, zoomOut } from "../hooks/useCanvasViewport";
import { IconButton } from "@/ui/IconButton";

export function ZoomControls() {
  const scale = useCanvasStore((s) => s.scale);
  return (
    <div role="group" aria-label="Zoom" className="flex items-center gap-0.5">
      <IconButton size="sm" label="Zoom out" icon={<Minus size={15} />} onClick={zoomOut} disabled={scale <= MIN_SCALE} />
      <span className="if-num w-11 text-center text-xs text-ink-2">{Math.round(scale * 100)}%</span>
      <IconButton size="sm" label="Zoom in" icon={<Plus size={15} />} onClick={zoomIn} disabled={scale >= MAX_SCALE} />
      <IconButton size="sm" label="Fit design to view" icon={<Scan size={15} />} onClick={fitCanvasView} />
    </div>
  );
}
