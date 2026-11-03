import { useEffect, useState } from "react";
import { sendAgain } from "@/features/model2Run/browserRuns";
import { describeBrowserRun, type BrowserRunMessage } from "@/features/model2Run/browserRunMessages";
import { useBrowserRunStatus } from "@/features/model2Run/browserRunStatus";
import { useReplayStatus } from "./useReplayStatus";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Page";

// The countdown only matters in the last minutes, so a slow tick is enough and costs nothing on slow hardware.
function useNow(active: boolean) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(performance.now()), 15_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function BrowserRunNoticeView({ message, sending, onSendAgain, onLeave }: { message: BrowserRunMessage; sending: boolean; onSendAgain: () => void; onLeave: () => void }) {
  return (
    <Notice tone={message.tone} title={message.title} role={message.tone === "fail" ? "alert" : "status"} className="mx-3 mt-2 shrink-0">
      <p>{message.body}</p>
      {message.action === "send-again" && <Button className="mt-2" size="sm" variant="secondary" loading={sending} onClick={onSendAgain}>Send again</Button>}
      {message.action === "leave" && <Button className="mt-2" size="sm" variant="secondary" onClick={onLeave}>Back to the designer</Button>}
    </Notice>
  );
}

/* Tells the learner what has happened to the run in their tab: whether it is running, being sent, saved by the
server, or lost, and what they can do. Only a run the server accepted is ever described as received. */
export function BrowserRunNotice({ deploymentId, onLeave, finished = false }: { deploymentId: string; onLeave: () => void; finished?: boolean }) {
  const state = useBrowserRunStatus((s) => s.runs[deploymentId]);
  const deadline = useBrowserRunStatus((s) => s.deadlines[deploymentId]);
  const now = useNow(state?.kind === "running" && deadline !== undefined);
  const replay = useReplayStatus(deploymentId, state?.kind === "accepted" && !finished);
  // Once the run is finished its report link is on the page, so "the report appears when it finishes" would be stale.
  const message = state?.kind === "accepted" && finished ? null : describeBrowserRun(state, deadline === undefined ? null : deadline - now, replay);
  if (!message) return null;
  return <BrowserRunNoticeView message={message} sending={state?.kind === "sending"} onSendAgain={() => void sendAgain(deploymentId)} onLeave={onLeave} />;
}
