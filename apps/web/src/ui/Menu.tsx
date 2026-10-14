import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export interface MenuItem { id: string; label: ReactNode; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: ReactNode; current?: boolean }

/* A small accessible menu button: Enter/Space/ArrowDown opens and focuses the
first item, arrows move, Escape closes and returns focus to the trigger. */
export function Menu({ trigger, triggerLabel, items, align = "end", header, className, triggerClassName, width = "w-60" }: {
  trigger: ReactNode; triggerLabel: string; items: Array<MenuItem | "separator">; align?: "start" | "end"; header?: ReactNode;
  className?: string; triggerClassName?: string; width?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const actionable = items.flatMap((item, index) => (item !== "separator" && !item.disabled ? [index] : []));

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const focusAt = (position: number) => itemRefs.current[actionable[(position + actionable.length) % actionable.length]!]?.focus();
  const show = (position = 0) => { setOpen(true); requestAnimationFrame(() => focusAt(position)); };
  const close = (refocus = true) => { setOpen(false); if (refocus) button.current?.focus(); };
  const onMenuKey = (event: KeyboardEvent) => {
    const current = actionable.indexOf(itemRefs.current.findIndex((node) => node === document.activeElement));
    if (event.key === "ArrowDown") { event.preventDefault(); focusAt(current + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusAt(current - 1); }
    else if (event.key === "Home") { event.preventDefault(); focusAt(0); }
    else if (event.key === "End") { event.preventDefault(); focusAt(actionable.length - 1); }
    else if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "Tab") setOpen(false);
  };

  return (
    <div ref={root} className={cx("relative", className)}>
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={triggerLabel}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(event.key === "ArrowUp" ? -1 : 0); } }}
        className={triggerClassName}>
        {trigger}
      </button>
      {open && (
        <div id={id} role="menu" aria-label={triggerLabel} onKeyDown={onMenuKey}
          className={cx("absolute top-full z-50 mt-1.5 rounded-lg border border-line bg-raised p-1 shadow-e2 if-rise", width, align === "end" ? "right-0" : "left-0")}>
          {header}
          {items.map((item, index) => item === "separator" ? <div key={`s${index}`} role="separator" className="my-1 h-px bg-line" /> : (
            <button key={item.id} ref={(node) => { itemRefs.current[index] = node; }} role="menuitem" type="button" tabIndex={-1}
              disabled={item.disabled} aria-current={item.current || undefined}
              onClick={() => { close(); item.onSelect(); }}
              className={cx("flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors disabled:opacity-40",
                "focus-visible:bg-sunken hover:bg-sunken", item.danger ? "text-fail" : "text-ink", item.current && "font-semibold")}>
              {item.icon && <span aria-hidden="true" className="text-ink-3">{item.icon}</span>}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && <span className="text-xs text-ink-3">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
