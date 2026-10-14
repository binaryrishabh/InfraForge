import * as Radix from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { cx } from "./cx";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Lock dismissal while work is in flight. */
  busy?: boolean;
  /** Destructive or input-heavy dialogs ignore outside clicks. */
  guarded?: boolean;
  eyebrow?: ReactNode;
}

const WIDTH = { sm: "sm:max-w-[420px]", md: "sm:max-w-[520px]", lg: "sm:max-w-[680px]", xl: "sm:max-w-[880px]" };

/* The one dialog system. Desktop: a centred card. Narrow screens: a bottom sheet
with the same focus trap. Focus returns to the control that opened it. */
export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md", busy = false, guarded = false, eyebrow }: DialogProps) {
  // Remember what had focus when the dialog was asked to open, before an autofocused field inside it takes focus.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (open) setOpener(active instanceof HTMLElement && active !== document.body ? active : null);
  }
  const outside: ComponentProps<typeof Radix.Content>["onPointerDownOutside"] = (event) => { if (busy || guarded) event.preventDefault(); };
  return (
    <Radix.Root open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <Radix.Portal>
        <Radix.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Radix.Content
          onCloseAutoFocus={(event) => {
            // Back to the control that opened it; a dialog the page opened itself hands focus to the main content.
            const target = opener?.isConnected ? opener : document.getElementById("main");
            if (target) { event.preventDefault(); target.focus(); }
          }}
          onPointerDownOutside={outside} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
          /* Without a description the title alone names the dialog; repeating it is noise. */
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cx("fixed z-50 flex flex-col bg-raised text-ink border border-line shadow-e3 outline-none",
            "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-lg [animation:if-sheet_200ms_var(--ease-out)]",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[calc(100vw-48px)] sm:max-h-[min(86dvh,860px)] sm:rounded-lg sm:[animation:if-pop_180ms_var(--ease-out)]",
            WIDTH[size])}>
          <div className="flex items-start gap-4 border-b border-line px-5 pt-4 pb-3.5">
            <div className="min-w-0 flex-1">
              {eyebrow && <p className="if-eyebrow mb-1">{eyebrow}</p>}
              <Radix.Title className="if-title text-[21px] text-ink">{title}</Radix.Title>
              {description && <Radix.Description className="mt-1 text-sm text-ink-2">{description}</Radix.Description>}
            </div>
            <Radix.Close disabled={busy} aria-label="Close" className="-mr-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink disabled:opacity-40">
              <X size={16} strokeWidth={1.75} aria-hidden="true" />
            </Radix.Close>
          </div>
          <div className="if-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3 sm:rounded-b-lg">{footer}</div>}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
