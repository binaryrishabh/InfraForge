import { useState } from "react";
import { PanelLeftClose, Search } from "lucide-react";
import { IconButton } from "@/ui/IconButton";
import { RESOURCE_TYPES, type ResourceType } from "@infraforge/domain/resource";
import { CATEGORY_LABEL, CATEGORY_OF, type ResourceCategory } from "@/theme/categories";
import { PaletteItem } from "./PaletteItem";

const ORDER: ResourceCategory[] = ["entry", "traffic", "compute", "data", "messaging", "observe"];
const TYPES = Object.values(RESOURCE_TYPES) as ResourceType[];

/* Docked resource palette. Drag a row onto the canvas, or activate it (click,
Enter or Space) to place it in the middle of the current view. */
export function PalettePanel({ disabled = false, onAdded, draggable = true, onCollapse }: { disabled?: boolean; onAdded?: () => void; draggable?: boolean; onCollapse?: () => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const groups = ORDER.map((category) => ({ category, types: TYPES.filter((t) => CATEGORY_OF[t] === category && (!q || t.toLowerCase().includes(q))) }))
    .filter((group) => group.types.length > 0);
  return (
    <section aria-label="Resources" className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-3 pt-3 pb-2.5">
        {draggable && (
          <div className="flex items-center justify-between">
            <h2 className="if-eyebrow">Resources</h2>
            {onCollapse && <IconButton size="sm" label="Collapse the resource list" icon={<PanelLeftClose size={15} />} onClick={onCollapse} className="-my-1 -mr-1.5" />}
          </div>
        )}
        <label className={draggable ? "relative mt-2 block" : "relative block"}>
          <span className="sr-only">Filter resources</span>
          <Search size={14} aria-hidden="true" className="absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter"
            className="h-8 w-full rounded-md border border-line-strong bg-raised pr-2 pl-8 text-[13px] text-ink placeholder:text-ink-3 focus-visible:border-accent" />
        </label>
      </div>
      <div className="if-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {groups.length === 0 && <p className="px-2 py-3 text-sm text-ink-3">No resource matches “{query.trim()}”.</p>}
        {groups.map((group) => (
          <div key={group.category} className="mb-2">
            <h3 className="px-2 pt-1.5 pb-1 text-[11px] font-semibold text-ink-3">{CATEGORY_LABEL[group.category]}</h3>
            <ul className="flex flex-col">{group.types.map((type) => <li key={type}><PaletteItem type={type} disabled={disabled} onAdded={onAdded} /></li>)}</ul>
          </div>
        ))}
      </div>
      <p className="border-t border-line px-3 py-2 text-[11.5px] leading-snug text-ink-3">{draggable ? "Drag onto the canvas, or press Enter to place in view." : "Choose a resource to place it in the middle of the view."}</p>
    </section>
  );
}
