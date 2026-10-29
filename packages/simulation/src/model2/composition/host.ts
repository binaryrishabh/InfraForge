import type { RemoteCompletion } from "../workload/contracts";
import type { EventClock, EventKernel } from "../time";
import type { Invocation, Receipt } from "../workload/contracts";
import type { CausalObserver } from "../workload/causal";
import type { cpuScheduler } from "../compute/scheduler";

export type RequestPort = (target: string, work: Invocation, done: RemoteCompletion) => Receipt;
// Version 1 deliberately exposes only the existing deterministic primitives.
// Adapters are trusted TypeScript; this is an API boundary, not a sandbox.
export interface ModuleHost {
  readonly clock: EventClock;
  readonly send: RequestPort;
  readonly causal?: CausalObserver;
  readonly cpu?: ReturnType<typeof cpuScheduler>;
}
export type CpuOwners = (id: string, clock: EventKernel) => ReturnType<typeof cpuScheduler> | undefined;
export type ClockOwners = (id: string, clock: EventKernel) => EventClock;
