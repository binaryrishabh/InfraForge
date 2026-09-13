import type { ReactNode } from "react";
import { hueBorder, hueTint } from "@/theme/resourceCategoryHues";

interface CardShellProps {
  hue: string;
  isRestarting: boolean;
  shakeAnimation?: string;
  minHeight: number;
  children: ReactNode;
}

/* The bordered, hue-tinted container both card states share: gradient wash,
inner top highlight, restart ring, shake animation, and the mode-driven
min-height that sets the card footprint. */
export function CardShell({ hue, isRestarting, shakeAnimation, minHeight, children }: CardShellProps) {
  return (
    <div
      className={`relative overflow-hidden border rounded-xl p-3 shadow-lg shadow-black/40 transition-colors duration-300 flex flex-col ${isRestarting ? "ring-2 ring-amber-400/60 animate-pulse" : ""}`}
      style={{
        borderColor: hueBorder(hue),
        background: `linear-gradient(180deg, ${hueTint(hue)} 0%, rgba(21,27,41,0) 45%), #151B29`,
        animation: shakeAnimation,
        minHeight,
      }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-white/10 to-transparent pointer-events-none" />
      {children}
    </div>
  );
}