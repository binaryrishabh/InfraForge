import { requireKnown, type Quantity } from "../../reality/quantity";
import type { EventKernel } from "../time";
import { cpuScheduler } from "../compute/scheduler";
import type { LifecycleIdentity } from "./lifecycle";

const key = (owner: LifecycleIdentity) => JSON.stringify([owner.id, owner.generation]);
export function memoryBudget(id: string, capacity: Quantity<"bytes">) {
  const limit = requireKnown(capacity, "bytes"), leases = new Map<string, number>();
  if (!id || !Number.isSafeInteger(limit) || limit < 0) throw Error("Invalid memory budget");
  let reserved = 0;
  return {
    reserve(owner: LifecycleIdentity, bytes: Quantity<"bytes">) {
      const amount = requireKnown(bytes, "bytes"), identity = key(owner);
      if (!Number.isSafeInteger(amount) || amount < 0 || leases.has(identity)) throw Error("Invalid/duplicate memory lease");
      if (amount > limit - reserved) return undefined;
      leases.set(identity, amount); reserved += amount; let released = false;
      return { release() { if (released) return false; released = true; leases.delete(identity); reserved -= amount; return true; } };
    },
    measure: () => ({ id, capacityBytes: limit, reservedBytes: reserved, availableBytes: limit - reserved, leases: leases.size }),
  };
}

// A single scheduler spends host core-time. Member views namespace work and
// suspend only their own jobs. Legacy compositions keep their original owners.
export function hostCpuPool(id: string, cores: Quantity<"cores">, clock: EventKernel) {
  const capacity = requireKnown(cores, "cores");
  if (!id || !Number.isFinite(capacity) || capacity <= 0) throw Error("Invalid host CPU pool");
  const scheduler = cpuScheduler(JSON.stringify(["host-cpu", id]), capacity, clock), members = new Set<string>();
  return {
    lease(owner: LifecycleIdentity) {
      const member = key(owner);
      if (members.has(member)) throw Error("Duplicate CPU pool member");
      members.add(member);
      type Job = Parameters<typeof scheduler.add>[0];
      const jobs = new Map<string, Job>(); let app = 0, competitor = 0, paused = false, released = false;
      const assertLive = () => { if (released) throw Error("Retired CPU lease"); };
      const scoped = (job: string) => JSON.stringify([member, job]);
      const remaining = (job: string) => scheduler.measure().allocations.find(j => j.id === scoped(job))?.remainingCoreUs;
      const account = (job: Job, amount: number) => { if (job.competitor) competitor += amount; else app += amount; };
      const submit = (job: Job) => scheduler.add({ ...job, id: scoped(job.id), done() {
        account(job, job.demand); jobs.delete(job.id); job.done();
      } });
      const view: ReturnType<typeof cpuScheduler> = {
        add(job) { assertLive(); if (!job.id || !Number.isFinite(job.demand) || job.demand < 0 || !Number.isFinite(job.cap) || job.cap <= 0) throw Error("Invalid CPU demand"); if (jobs.has(job.id)) throw Error("Duplicate runnable invocation"); jobs.set(job.id, job); if (!paused) submit(job); },
        remove(jobId) {
          assertLive(); const job = jobs.get(jobId); if (!job) return;
          if (!paused) { account(job, job.demand - (remaining(jobId) ?? 0)); scheduler.remove(scoped(jobId)); }
          jobs.delete(jobId);
        },
        pause(value) {
          assertLive(); if (value === paused) return;
          if (value) for (const [jobId, job] of jobs) {
            const left = remaining(jobId) ?? 0; account(job, job.demand - left); scheduler.remove(scoped(jobId)); jobs.set(jobId, { ...job, demand: left });
          }
          paused = value;
          if (!paused) for (const job of [...jobs.values()]) submit(job);
        },
        capacity() { throw Error("Shared CPU capacity belongs to the host pool"); },
        measure() {
          const total = scheduler.measure(), allocations = total.allocations.filter(j => jobs.has(JSON.parse(j.id)[1]) && JSON.parse(j.id)[0] === member).map(j => ({ ...j, id: JSON.parse(j.id)[1] as string }));
          const consumed = (isCompetitor: boolean) => [...jobs.values()].filter(j => !!j.competitor === isCompetitor).reduce((sum, job) => sum + (paused ? 0 : job.demand - (allocations.find(j => j.id === job.id)?.remainingCoreUs ?? 0)), 0);
          return { ...total, paused, runnable: jobs.size, receivingShare: allocations.filter(j => j.cores > 0).length, allocations,
            appCoreUs: app + consumed(false), competitorCoreUs: competitor + consumed(true) };
        },
      };
      return { scheduler: view, release() { if (released) return false; for (const job of [...jobs.keys()]) view.remove(job); released = true; members.delete(member); return true; } };
    },
    measure: () => ({ id, ...scheduler.measure(), members: members.size }),
  };
}
