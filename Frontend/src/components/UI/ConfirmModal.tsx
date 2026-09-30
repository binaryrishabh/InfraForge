import { Modal } from "./Modal";
import { CANCEL_BUTTON_CLASS } from "@/theme/controlClasses";

interface ConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  consequences: Array<{ icon: "danger" | "warning"; text: string }>;
  confirmLabel: string;
  intent?: "primary" | "danger";
  metadata?: string;
  loading?: boolean;
  onConfirm: () => void;
}

export function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  consequences,
  confirmLabel,
  intent = "primary",
  metadata,
  loading = false,
  onConfirm,
}: ConfirmModalProps) {
  const isDanger = intent === "danger";
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      destructive={isDanger}
      loading={loading}
    >
      <div>
        {metadata && (
          <p className="font-mono text-xs text-[#5A5F6B] mb-3">
            {metadata}
          </p>
        )}
        {consequences.length > 0 && (
          <div className="space-y-1.5 mb-2">
            {consequences.map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                {item.icon === "danger" ? (
                  // Inset coordinates to prevent stroke clipping
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mt-0.5 shrink-0">
                    <path d="M7 2.5L12 11.5H2L7 2.5Z" stroke="#C4574A" strokeWidth="1.2" strokeLinejoin="round" />
                    <line x1="7" y1="5.5" x2="7" y2="8.5" stroke="#C4574A" strokeWidth="1.2" strokeLinecap="round" />
                    <circle cx="7" cy="10.5" r="0.75" fill="#C4574A" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mt-0.5 shrink-0">
                    <path d="M7 2.5L12 11.5H2L7 2.5Z" stroke="#C98A4B" strokeWidth="1.2" strokeLinejoin="round" />
                    <line x1="7" y1="5.5" x2="7" y2="8.5" stroke="#C98A4B" strokeWidth="1.2" strokeLinecap="round" />
                    <circle cx="7" cy="10.5" r="0.75" fill="#C98A4B" />
                  </svg>
                )}
                <span className="text-[13px] text-[#8B909C] leading">{item.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/*
        RADIX FOCUS FIX:
        If primary, we reverse the DOM order so Radix naturally focuses the Confirm button first.
        flex-row-reverse keeps the visual layout correct (Cancel left, Confirm right).
      */}
      <div className={`flex gap-2 justify-end mt-6 ${!isDanger ? "flex-row-reverse" : ""}`}>
        {/* Confirm Button (Rendered first in DOM for Primary intent) */}
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className={`h-8 px-3 rounded-lg text-[13px] font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 ${
            isDanger
              ? "bg-[#C4574A] text-[#EDEEF0] hover:bg-[#D0685C] active:bg-[#B34C40] active:scale-[0.98]"
              : "bg-[#4FA89B] text-[#14161A] hover:bg-[#5FBBA9] active:bg-[#459788] active:scale-[0.98]"
          }`}
        >
          {loading && (
            <span className={`w-3.5 h-3.5 border-2 rounded-full animate-spin ${
              isDanger ? "border-[#EDEEF0]/30 border-t-[#EDEEF0]" : "border-[#14161A]/30 border-t-[#14161A]"
            }`} />
          )}
          {confirmLabel}
        </button>
        {/* Cancel Button (Rendered second in DOM for Primary intent) */}
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          disabled={loading}
          className={CANCEL_BUTTON_CLASS}
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}