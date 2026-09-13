import { ResourceHealth } from "@shared/enum/ResourceHealth.enum";

export const healthChipStyles: Record<string, { text: string; border: string; dotBg: string }> = {
  [ResourceHealth.HEALTHY]: { text: "text-emerald-400", border: "border-emerald-400/40", dotBg: "bg-emerald-400" },
  [ResourceHealth.DEGRADED]: { text: "text-amber-400", border: "border-amber-400/40", dotBg: "bg-amber-400" },
  [ResourceHealth.SATURATED]: { text: "text-red-400", border: "border-red-400/40", dotBg: "bg-red-400" },
  [ResourceHealth.FAILED]: { text: "text-red-500", border: "border-red-500/40", dotBg: "bg-red-500" },
};

export const healthColorHex: Record<string, string> = {
  [ResourceHealth.HEALTHY]: "#34d399",
  [ResourceHealth.DEGRADED]: "#fbbf24",
  [ResourceHealth.SATURATED]: "#f87171",
  [ResourceHealth.FAILED]: "#ef4444",
};

export function getBarColor(pct: number): string {
  if (pct >= 90) return "bg-[#F0564A]";
  if (pct >= 70) return "bg-[#F5A524]";
  return "bg-emerald-500";
}