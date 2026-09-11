import { useState } from "react";
import { X } from "lucide-react";

const GESTURE_HINT_DISMISSED_KEY = "infraforge_gesture_hint_dismissed";

/* Dismissible onboarding hint for the canvas gestures. Dismissal persists
in localStorage so it never nags twice; both design and live modes share it. */
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
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-[#12161F]/80 backdrop-blur-md border border-[#1F2633] rounded-full px-3 py-1.5 select-none shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[#677185] whitespace-nowrap">
        drag to move · drag from a port to connect · click to inspect · del
        removes selected line
      </span>
      <button
        type="button"
        title="Dismiss hint"
        onClick={handleDismiss}
        className="text-[#677185] hover:text-[#EDF1F7] transition-colors duration-150 cursor-pointer flex items-center justify-center"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  );
}