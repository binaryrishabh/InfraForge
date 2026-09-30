import type { ReactNode } from "react";

interface CardShellProps {
  stripe: string;
  isRestarting: boolean;
  shakeAnimation?: string;
  minHeight: number;
  children: ReactNode;
}

/* Flat engineered card: solid surface, single low-contrast border, and a
2px category stripe on the left edge instead of an icon badge. No gradient
wash, no glow, small radius — control-room, not consumer SaaS. */
export function CardShell({ stripe, isRestarting, shakeAnimation, minHeight, children }: CardShellProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-md border border-[#2A2E37] bg-[#1C1F26] p-3 pl-4 transition-colors duration-300 flex flex-col ${isRestarting ? "ring-1 ring-[#C98A4B]/60 animate-pulse" : ""}`}
      style={{ animation: shakeAnimation, minHeight }}
    >
      {/* Category identity lives here — one thin stripe, nothing louder. */}
      <span
        className="absolute left-0 top-0 bottom-0 w-0.5"
        style={{ background: stripe }}
      />
      {children}
    </div>
  );
}