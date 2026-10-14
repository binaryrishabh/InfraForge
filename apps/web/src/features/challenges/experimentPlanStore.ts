import { create } from "zustand";
import type { ExperimentPlan } from "./experiment";

// The resilience experiment on screen (a workspace's challenge or a live attempt), read by the node cards.
export const useExperimentPlan = create<{ plan: ExperimentPlan | null; setPlan: (plan: ExperimentPlan | null) => void }>()((set) => ({
  plan: null,
  setPlan: (plan) => set({ plan }),
}));
