import { useState } from "react";
import { X } from "lucide-react";

const GESTURE_HINT_DISMISSED_KEY = "infraforge_gesture_hint_dismissed";

/* Dismissible onboarding hint for the canvas gestures. Dismissal persists
in localStorage so it never nags twice; both design and live modes share it.
Solid surface, no blur — the control-room grammar. */
export function GestureHintPill() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(GESTURE_HINT_DISMISSED_KEY) === "1",
  );

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(GESTURE_HINT_DISMISSED_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-[#1C1F26] border border-[#2A2E37] rounded-full px-3 py-1.5 select-none shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[#5A5F6B] whitespace-nowrap">
        drag to move · drag from a port to connect · click to inspect · del
        removes selected line
      </span>
      <button
        type="button"
        title="Dismiss hint"
        onClick={handleDismiss}
        className="text-[#5A5F6B] hover:text-[#EDEEF0] transition-colors duration-150 cursor-pointer flex items-center justify-center"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  );
}