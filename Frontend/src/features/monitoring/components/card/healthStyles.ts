import { ResourceHealth } from "@shared/enum/ResourceHealth.enum";

/* Semantic health tones only: teal = healthy/active, bronze = degraded,
brick = saturated/failed. No glow, no neon — flat dots and text. */
export const healthChipStyles: Record<string, { text: string; border: string; dotBg: string }> = {
  [ResourceHealth.HEALTHY]: { text: "text-[#4FA89B]", border: "border-[#4FA89B]/40", dotBg: "bg-[#4FA89B]" },
  [ResourceHealth.DEGRADED]: { text: "text-[#C98A4B]", border: "border-[#C98A4B]/40", dotBg: "bg-[#C98A4B]" },
  [ResourceHealth.SATURATED]: { text: "text-[#C4574A]", border: "border-[#C4574A]/40", dotBg: "bg-[#C4574A]" },
  [ResourceHealth.FAILED]: { text: "text-[#C4574A]", border: "border-[#C4574A]/50", dotBg: "bg-[#C4574A]" },
};

export const healthColorHex: Record<string, string> = {
  [ResourceHealth.HEALTHY]: "#4FA89B",
  [ResourceHealth.DEGRADED]: "#C98A4B",
  [ResourceHealth.SATURATED]: "#C4574A",
  [ResourceHealth.FAILED]: "#C4574A",
};

export function getBarColor(pct: number): string {
  if (pct >= 90) return "bg-[#C4574A]";
  if (pct >= 70) return "bg-[#C98A4B]";
  return "bg-[#4FA89B]";
}