export type CapabilityAvailability = Record<"run" | "save" | "export", { allowed: boolean; reason: string; revision: string }>;
