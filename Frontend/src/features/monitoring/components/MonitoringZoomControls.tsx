import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

interface MonitoringZoomControlsProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export function MonitoringZoomControls({ scale, onZoomIn, onZoomOut, onReset }: MonitoringZoomControlsProps) {
  return (
    <div className="absolute bottom-4 right-4 z-50 flex items-center gap-0.5 bg-[#12161F] border border-[#273042] rounded-lg p-1 shadow-xl select-none">
      <button
        type="button"
        title="Zoom out"
        onClick={onZoomOut}
        className="w-7 h-7 rounded-md bg-[#0B0E14] border border-[#1F2633] text-[#AAB4C5] hover:text-[#EDF1F7] hover:border-[#35415A] active:scale-[0.95] transition-all duration-150 flex items-center justify-center"
      >
        <ZoomOut size={14} strokeWidth={1.75} />
      </button>
      <span className="w-12 text-center text-[11px] font-mono text-[#AAB4C5]">
        {Math.round(scale * 100)}%
      </span>
      <button
        type="button"
        title="Zoom in"
        onClick={onZoomIn}
        className="w-7 h-7 rounded-md bg-[#0B0E14] border border-[#1F2633] text-[#AAB4C5] hover:text-[#EDF1F7] hover:border-[#35415A] active:scale-[0.95] transition-all duration-150 flex items-center justify-center"
      >
        <ZoomIn size={14} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        title="Fit view"
        onClick={onReset}
        className="w-7 h-7 rounded-md bg-[#0B0E14] border border-[#1F2633] text-[#AAB4C5] hover:text-[#EDF1F7] hover:border-[#35415A] active:scale-[0.95] transition-all duration-150 flex items-center justify-center"
      >
        <RotateCcw size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}