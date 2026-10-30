/** Opt-in /3 helper response; confirmation establishes broker logical ownership only. */
export interface FlowPublishReply {
  stage: "upload" | "publish";
  replyReason: string | null;
  confirmation: "confirmed" | "refused" | "not-dispatched" | "Unknown";
  ambiguous: boolean;
}
