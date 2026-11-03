import type { BrowserRunState } from "@/features/model2Run/browserRunStatus";

/* What Home says about a run that lives in a browser tab. A browser run is not running on the server: the tab that
started it is the only place it exists, so the card says what this tab still holds and what can honestly be done. */
export type HeldRun = "worker" | BrowserRunState["kind"] | "nothing";

export interface BrowserRunCard {
  eyebrow: string; title: string; body: string;
  // Opens the run in the designer. Starting again is only offered when the run has to begin from the beginning.
  open: string;
  // Closes a run that cannot continue, so it stops counting against the learner's runs.
  canDiscard: boolean;
}

export function describeBrowserRunCard(held: HeldRun, name: string, startedAgo: string): BrowserRunCard {
  switch (held) {
    case "unsent":
      return { eyebrow: "Not saved yet", title: "Your finished run has not been saved", canDiscard: false, open: "Open it and send again",
        body: `“${name}” reached its end but the server did not receive it. It exists only in this tab, so keep the tab open. Open it to send it again.` };
    case "sending":
    case "accepted":
      return { eyebrow: "Sending", title: "Your run is being sent", canDiscard: false, open: "Open the run",
        body: `“${name}” is on its way to the server for the official replay. It is not saved until the server accepts it.` };
    case "worker":
    case "running":
    case "starting":
      return { eyebrow: "A run is live", title: name, canDiscard: false, open: "Return to the run",
        body: `Started ${startedAgo} and running in this tab. It only exists here: closing the tab ends it without a saved result.` };
    default:
      return { eyebrow: "Not running", title: `“${name}” is waiting for a browser`, canDiscard: true, open: "Start it again",
        body: `Started ${startedAgo}. A browser run lives in the tab that started it, and that tab is gone, so nothing is running and nothing was saved. Start it again from the beginning, or discard it. The server closes it by itself 30 minutes after it started.` };
  }
}
