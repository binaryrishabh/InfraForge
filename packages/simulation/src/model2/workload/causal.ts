import type { Invocation } from "./contracts";
// Optional observation of actual transitions. It never schedules or controls work.
export interface CausalEvent {
  atUs: number; kind: string; resource: string;
  work?: Pick<Invocation, "rootId" | "callId" | "parentCallId" | "attempt" | "operation" | "offeredAt">;
  detail: Record<string, string | number | boolean | null>;
}
export type CausalObserver = (event: CausalEvent) => void;
