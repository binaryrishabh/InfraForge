import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  RESOURCE_TYPES,
  type ResourceType,
} from "@shared/constants/RESOURCE_TYPES.constants";
import { ResourcePaletteItem } from "./ResourcePaletteItem";
import { PRODUCT_SUBLABELS, capacityLabel } from "../utils/paletteMetadata";

// Drawer geometry: floating rounded panel inset from the edges; the toggle
// rides exactly one gap to the right of the drawer's right edge so the two
// move as one unit.
const DRAWER_WIDTH = 256;
const EDGE_GAP = 12;
const OPEN_TOGGLE_LEFT = EDGE_GAP + DRAWER_WIDTH + EDGE_GAP;

// Premium glide for the slide-in/out and the toggle ride.
const DRAWER_EASE = "ease-[cubic-bezier(0.32,0.72,0,1)]";

interface PaletteGroup {
  title: string;
  types: ResourceType[];
}

/* Category groups mirror the hue categories (Section 9) so the palette
teaches the same identity grammar the canvas uses. */
const PALETTE_GROUPS: PaletteGroup[] = [
  { title: "Entry & Edge", types: [RESOURCE_TYPES.DNS, RESOURCE_TYPES.CDN] },
  {
    title: "Traffic & Security",
    types: [RESOURCE_TYPES.Firewall, RESOURCE_TYPES.LoadBalancer],
  },
  {
    title: "Compute",
    types: [RESOURCE_TYPES.VirtualMachine, RESOURCE_TYPES.ContainerRegistry],
  },
  {
    title: "Data",
    types: [
      RESOURCE_TYPES.Cache,
      RESOURCE_TYPES.Database,
      RESOURCE_TYPES.ObjectStorage,
    ],
  },
  { title: "Async & Messaging", types: [RESOURCE_TYPES.MessageQueue] },
  { title: "Observability", types: [RESOURCE_TYPES.MonitoringAgent] },
];

export function ResourcePaletteDrawer() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Click anywhere outside the drawer (and outside its toggle) closes it.
  // Pointerdown on a palette row is INSIDE the drawer, so dragging a
  // resource onto the canvas never closes the drawer mid-drag.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-palette-drawer]")) return;
      if (target.closest("[data-palette-toggle]")) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = PALETTE_GROUPS.map((group) => ({
    ...group,
    types:
      normalizedQuery === ""
        ? group.types
        : group.types.filter((type) =>
            type.toLowerCase().includes(normalizedQuery),
          ),
  })).filter((group) => group.types.length > 0);

  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      {/* Drawer panel — slides out of / into the left edge */}
      <div
        data-palette-drawer
        className={`pointer-events-auto absolute top-16 bottom-4 left-3 rounded-xl bg-[#12161F]/95 backdrop-blur-md border border-[#273042] shadow-[0_12px_32px_rgba(0,0,0,0.45)] flex flex-col overflow-hidden transition-transform duration-300 ${DRAWER_EASE} ${
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
        {/* Search — filters groups case-insensitively by type label */}
        <div className="px-3 pb-2 shrink-0">
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="search resources…"
            className="w-full h-8 rounded-lg bg-[#0B0E14] border border-[#273042] text-[12px] text-[#EDF1F7] placeholder-[#677185] px-2.5 outline-none focus:border-[#5B8CFF] transition-colors duration-150"
          />
        </div>
        {/* Scrollable list — thin custom scrollbar, never the browser default */}
        <div className="infraforge-scroll flex-1 overflow-y-auto px-3 pb-3 flex flex-col">
          {visibleGroups.length === 0 ? (
            <p className="text-[10px] text-[#677185] px-2 pt-2">
              no resources match “{query.trim()}”
            </p>
          ) : (
            visibleGroups.map((group) => (
              <div key={group.title}>
                <p className="text-[9px] uppercase tracking-wider text-[#677185] px-2 pt-2 pb-1">
                  {group.title}
                </p>
                <div className="flex flex-col gap-1">
                  {group.types.map((type) => (
                    <ResourcePaletteItem
                      key={type}
                      label={type}
                      sublabel={PRODUCT_SUBLABELS[type]}
                      capacity={capacityLabel(type)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      {/* Toggle — stays top-left when closed, rides the drawer's right edge
          when open, on the same glide curve as the panel. */}
      <button
        type="button"
        data-palette-toggle
        onClick={() => setOpen(!open)}
        title={open ? "Close palette" : "Open palette"}
        className={`pointer-events-auto absolute top-16 w-9 h-9 rounded-lg bg-[#12161F]/95 backdrop-blur-md border border-[#273042] text-[#AAB4C5] hover:text-[#EDF1F7] hover:border-[#35415A] shadow-[0_4px_12px_rgba(0,0,0,0.35)] flex items-center justify-center transition-[left] duration-300 ${DRAWER_EASE}`}
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