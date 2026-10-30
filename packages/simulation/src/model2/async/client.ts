import type { Deliver } from "../compute/run";
import type { Invocation, RemoteOutcome } from "../workload/contracts";
import type { Cause } from "../workload/cause";
export function messageClient(parent: Invocation, send: Deliver) {
  let sequence = 0;
  return <T>(target: string, request: unknown, done: (reply: T | undefined, outcome: RemoteOutcome, cause?: Cause) => void, bodyBytes = 0) => {
    const work: Invocation = { ...parent, parentCallId: parent.callId, callId: JSON.stringify([...JSON.parse(parent.callId), "async", sequence++, target]), message: { request, bodyBytes: { request: bodyBytes } } };
    return send(target, work, (outcome, cause) => done(work.message!.response as T | undefined, outcome, cause));
  };
}
