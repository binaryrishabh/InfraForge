import { useState, useEffect } from "react";
import { Modal } from "./Modal";
import {
  INPUT_CLASS,
  LABEL_CLASS,
  CANCEL_BUTTON_CLASS,
} from "@/theme/controlClasses";

interface TypeToConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  infrastructureName: string;
  loading?: boolean;
  onConfirm: () => void;
}

export function TypeToConfirmModal({
  open,
  onOpenChange,
  infrastructureName,
  loading = false,
  onConfirm,
}: TypeToConfirmModalProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setError(null);
    }
  }, [open]);

  // Exact match. We don't trim the infrastructureName because if it has spaces, the user should type them.
  const isMatch = value.trim() === infrastructureName.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isMatch) {
      setError("Name does not match.");
      return;
    }
    onConfirm();
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Delete infrastructure"
      description="This permanently deletes the selected infrastructure and its saved layout."
      destructive
      loading={loading}
      width="480px"
    >
      <form onSubmit={handleSubmit}>
        {/* Danger banner */}
        <div className="flex items-center gap-2 bg-[rgba(196,87,74,0.08)] border border-[rgba(196,87,74,0.25)] rounded-lg px-3 py-2.5 mb-4">
          {/* Inset coordinates to prevent stroke clipping */}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
            <path d="M7 2.5L12 11.5H2L7 2.5Z" stroke="#C4574A" strokeWidth="1.2" strokeLinejoin="round" />
            <line x1="7" y1="5.5" x2="7" y2="8.5" stroke="#C4574A" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="7" cy="10.5" r="0.75" fill="#C4574A" />
          </svg>
          <span className="text-xs text-[#C4574A]">This action cannot be undone.</span>
        </div>
        {/* Infrastructure name chip */}
        <div className="mb-4">
          <p className="text-[11px] text-[#5A5F6B] uppercase tracking-wide mb-1.5">Deleting</p>
          <span className="font-mono text-xs text-[#EDEEF0] bg-[#14161A] border border-[#2A2E37] rounded-md px-2 py-1">
            {infrastructureName}
          </span>
        </div>
        {/* Input */}
        <div>
          <label className={LABEL_CLASS}>
            Type the infrastructure name to confirm
          </label>
          <input
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Infrastructure name"
            disabled={loading}
            className={`${INPUT_CLASS} ${
              error
                ? "!border-[#C4574A] !shadow-[0_0_0_3px_rgba(196,87,74,0.16)]"
                : isMatch
                  ? "!border-[rgba(196,87,74,0.65)] !shadow-[0_0_0_3px_rgba(196,87,74,0.16)]" // "Armed" state
                  : ""
            } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
          />
          {error ? (
            <p className="text-xs text-[#C4574A] mt-1.5">{error}</p>
          ) : (
            <p className="text-xs text-[#5A5F6B] mt-1.5">
              Deletion will be enabled once the name matches exactly.
            </p>
          )}
        </div>
        {/* Footer */}
        <div className="flex gap-2 justify-end mt-6">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className={CANCEL_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isMatch || loading}
            // Using Tailwind's native disabled: modifiers for a much cleaner implementation
            className="h-8 px-3 rounded-lg text-[13px] font-medium transition-all duration-150 flex items-center gap-1.5
              bg-[#C4574A] text-[#EDEEF0] hover:bg-[#D0685C] active:bg-[#B34C40] active:scale-[0.98]
              disabled:bg-[rgba(196,87,74,0.08)] disabled:border disabled:border-[rgba(196,87,74,0.18)] disabled:text-[rgba(196,87,74,0.45)] disabled:cursor-not-allowed disabled:hover:bg-[rgba(196,87,74,0.08)]"
          >
            {loading && (
              <span className="w-3.5 h-3.5 border-2 border-[#EDEEF0]/30 border-t-[#EDEEF0] rounded-full animate-spin" />
            )}
            Delete permanently
          </button>
        </div>
      </form>
    </Modal>
  );
}