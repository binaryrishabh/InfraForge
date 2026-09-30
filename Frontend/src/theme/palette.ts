/* InfraForge control-room palette (owner-directed redesign).
Warm near-black canvas, solid low-contrast surfaces, ONE warm accent
reserved for the single most important action (Deploy), ONE muted teal for
status/active, ONE brick red for danger. No purple/indigo, no gradients,
no glow, no frosted blur — hierarchy comes from weight and opacity. */
export const PALETTE = {
  bg: "#14161A",
  surface: "#1C1F26",
  border: "#2A2E37",
  accent: "#E8A33D",
  secondary: "#4FA89B",
  danger: "#C4574A",
  warning: "#C98A4B",
  textPrimary: "#EDEEF0",
  textSecondary: "#8B909C",
  textTertiary: "#5A5F6B",
} as const;