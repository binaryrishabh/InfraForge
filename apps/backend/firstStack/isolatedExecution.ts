import type { IsolationControl } from "./isolationConnection";
import { runFirstStackContainer, type IsolationAuthority, type IsolationConfiguration } from "./isolationRunner";
import type { IsolatedCut } from "./isolationProtocol";

// Slice 11's owned immutable store/queue calls these boundaries. No public route
// or active worker dispatcher is installed by this containment slice.
export function executeFirstStackIsolated(control: IsolationControl, configuration: IsolationConfiguration,
  input: string, authority: IsolationAuthority, signal?: AbortSignal) {
  return runFirstStackContainer(control, configuration, { mode: "execute", input }, authority, signal);
}
export function replayFirstStackIsolated(control: IsolationControl, configuration: IsolationConfiguration,
  input: string, expected: IsolatedCut, authority: IsolationAuthority, signal?: AbortSignal) {
  return runFirstStackContainer(control, configuration, { mode: "replay", input, expected }, authority, signal);
}
