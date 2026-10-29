/** Bounded observed flow transitions; omitted rows are counted explicitly. */
export interface ApplicationFlowEvidence {
  profile: "application-flow/1";
  events: Array<{
    atUs: number; kind: string; resource: string;
    work?: { rootId: string; callId: string; parentCallId?: string; attempt: number; operation: string; offeredAt: number };
    detail: Record<string, string | number | boolean | null>;
  }>;
  totals: Record<string, number>;
  retained: number;
  omitted: number;
}
