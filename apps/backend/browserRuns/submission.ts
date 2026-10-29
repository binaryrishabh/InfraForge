import { interventionError } from "@infraforge/domain/resource";
import { z } from "zod";
import { MAX_RUN_ACTIONS } from "@infraforge/simulation/model2-run";
import { ActionRequestSchema } from "../actions/contract";
import { ValidationError } from "../utils/errors";

// What a browser sends when its Model 2 run ends: the second it stopped at and each action it applied, in order.
// The server replays exactly this; the browser's own numbers are never stored.
export const SubmissionSchema = z.object({
  stopAtSecond: z.number().int().min(1).max(3600),
  actions: z.array(z.object({ atSecond: z.number().int().min(0), request: ActionRequestSchema }).strict()).max(MAX_RUN_ACTIONS),
}).strict();
export type BrowserSubmission = z.infer<typeof SubmissionSchema>;

const REPLAYABLE = new Set(["load", "chaos", "pool-scale", "intervention"]);

// Checks that need the run itself: its length, challenge rules and action order.
export function checkSubmission(value: unknown, run: { horizonSeconds: number; challenge: boolean }): BrowserSubmission {
  const parsed = SubmissionSchema.safeParse(value);
  if (!parsed.success) throw new ValidationError("The run submission is malformed.");
  const submission = parsed.data;
  if (submission.stopAtSecond > run.horizonSeconds) throw new ValidationError("The run cannot stop after its length.");
  if (run.challenge && submission.actions.length) throw new ValidationError("A challenge attempt takes no actions besides its scheduled fault.");
  let previous = 0;
  for (const { atSecond, request } of submission.actions) {
    if (atSecond < previous || atSecond > submission.stopAtSecond) throw new ValidationError("Actions must be in order and no later than the stop second.");
    if (!REPLAYABLE.has(request.kind) || (request.kind === "chaos" && request.parameters.trigger)) {
      throw new ValidationError("Only load, fault, intervention and replica actions are replayed.");
    }
    if (request.kind === "intervention") {
      const error = interventionError(request.parameters, {remainingSeconds: Math.floor(run.horizonSeconds - atSecond - 0.000001)});
      if (error) throw new ValidationError(error);
    }
    previous = atSecond;
  }
  return submission;
}
