import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export interface TabItem<T extends string> { id: T; label: ReactNode; badge?: ReactNode }

// WAI-ARIA tabs with roving focus; arrow keys move and activate.
export function Tabs<T extends string>({ items, value, onChange, label, className, idBase }: {
  items: TabItem<T>[]; value: T; onChange: (id: T) => void; label: string; className?: string; idBase: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (event: KeyboardEvent, index: number) => {
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = (next + items.length) % items.length;
    onChange(items[target]!.id);
    refs.current[target]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={cx("flex gap-1 border-b border-line", className)}>
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button key={item.id} ref={(node) => { refs.current[index] = node; }} role="tab" type="button"
            id={`${idBase}-tab-${item.id}`} aria-controls={`${idBase}-panel-${item.id}`} aria-selected={selected} tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)} onKeyDown={(event) => onKey(event, index)}
            className={cx("relative -mb-px inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors",
              selected ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
            {item.label}{item.badge}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idBase, id, children, className }: { idBase: string; id: string; children: ReactNode; className?: string }) {
  return <div role="tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-tab-${id}`} tabIndex={0} className={cx("outline-none", className)}>{children}</div>;
}
