import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import { ResourcePaletteItem } from "./ResourcePaletteItem";

// Drawer geometry: floating rounded panel inset from the edges; the toggle
// rides exactly one gap to the right of the drawer's right edge so the two
// move as one unit.
const DRAWER_WIDTH = 256;
const EDGE_GAP = 12;
const OPEN_TOGGLE_LEFT = EDGE_GAP + DRAWER_WIDTH + EDGE_GAP;

export function ResourcePaletteDrawer() {
  const [open, setOpen] = useState(false);

  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      {/* Drawer panel — slides out of / into the left edge */}
      <div
        className={`pointer-events-auto absolute top-16 bottom-4 left-3 rounded-xl bg-[#12161F]/95 backdrop-blur-md border border-[#273042] shadow-[0_12px_32px_rgba(0,0,0,0.45)] flex flex-col overflow-hidden transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-[calc(100%+12px)]"
        }`}
        style={{ width: DRAWER_WIDTH }}
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
          <span className="text-[11px] uppercase tracking-wider text-[#677185] font-semibold">
            Resources
          </span>
          <span className="text-[10px] text-[#677185]">drag to canvas</span>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-1">
          <ResourcePaletteItem label={RESOURCE_TYPES.DNS} />
          <ResourcePaletteItem label={RESOURCE_TYPES.CDN} />
          <ResourcePaletteItem label={RESOURCE_TYPES.Firewall} />
          <ResourcePaletteItem label={RESOURCE_TYPES.LoadBalancer} />
          <ResourcePaletteItem label={RESOURCE_TYPES.VirtualMachine} />
          <ResourcePaletteItem label={RESOURCE_TYPES.ContainerRegistry} />
          <ResourcePaletteItem label={RESOURCE_TYPES.Cache} />
          <ResourcePaletteItem label={RESOURCE_TYPES.Database} />
          <ResourcePaletteItem label={RESOURCE_TYPES.ObjectStorage} />
          <ResourcePaletteItem label={RESOURCE_TYPES.MessageQueue} />
          <ResourcePaletteItem label={RESOURCE_TYPES.MonitoringAgent} />
        </div>
      </div>

      {/* Toggle — stays top-left when closed, rides the drawer's right edge when open */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={open ? "Close palette" : "Open palette"}
        className="pointer-events-auto absolute top-16 w-9 h-9 rounded-lg bg-[#12161F]/95 backdrop-blur-md border border-[#273042] text-[#AAB4C5] hover:text-[#EDF1F7] hover:border-[#35415A] shadow-[0_4px_12px_rgba(0,0,0,0.35)] flex items-center justify-center transition-[left] duration-200 ease-out"
        style={{ left: open ? OPEN_TOGGLE_LEFT : EDGE_GAP }}
      >
        {open ? (
          <PanelLeftClose size={16} strokeWidth={1.75} />
        ) : (
          <PanelLeftOpen size={16} strokeWidth={1.75} />
        )}
      </button>
    </div>
  );
}