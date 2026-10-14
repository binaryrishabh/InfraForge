import { create } from "zustand";

export type ThemePreference = "paper" | "ink" | "system";
export type DensityPreference = "comfortable" | "compact";
interface Preferences { theme: ThemePreference; density: DensityPreference; setTheme: (theme: ThemePreference) => void; setDensity: (density: DensityPreference) => void }

const KEY = "infraforge:preferences";
// Per-viewer conveniences only; storage may be unavailable and the app still renders.
function read(): Pick<Preferences, "theme" | "density"> {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Preferences>;
    return { theme: value.theme === "ink" || value.theme === "system" ? value.theme : "paper", density: value.density === "compact" ? "compact" : "comfortable" };
  } catch { return { theme: "paper", density: "comfortable" }; }
}
function write(value: Pick<Preferences, "theme" | "density">) { try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* storage unavailable */ } }

export const usePreferences = create<Preferences>((set, get) => ({
  ...read(),
  setTheme: (theme) => { set({ theme }); write({ theme, density: get().density }); },
  setDensity: (density) => { set({ density }); write({ theme: get().theme, density }); },
}));

export function resolvedTheme(theme: ThemePreference): "paper" | "ink" {
  if (theme !== "system") return theme;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "ink" : "paper";
}

export function applyPreferences(theme: ThemePreference, density: DensityPreference) {
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme(theme);
  root.dataset.density = density;
}
