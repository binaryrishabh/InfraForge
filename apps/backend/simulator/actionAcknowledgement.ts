import type { ActionOutcome } from "@infraforge/contracts/actions";
import type { Prisma } from "../lib/generated/prisma/client";
import { prisma } from "../lib/prisma";
import type { SimulationInstance } from "./instance";

export type ActionWrite = {
  status: "running" | "completed" | "failed" | "cancelled";
  appliedAt?: Date; appliedSimulatedSeconds?: number;
  completedAt?: Date; completedSimulatedSeconds?: number;
  outcome?: ActionOutcome; failureReason?: string;
};
export async function flushAcknowledgement(instance: SimulationInstance) {
  if (!instance.acknowledge) return;
  await instance.acknowledge();
  instance.acknowledge = null;
}
export async function acknowledgeAction(instance: SimulationInstance, id: string, data: ActionWrite) {
  instance.acknowledge = async () => {
    const changed = await prisma.runAction.updateMany({ where: { id, status: { in: ["applying", "running"] } },
      data: { ...data, outcome: data.outcome as Prisma.InputJsonValue | undefined } });
    if (changed.count !== 1) {
      // A lost database reply may follow a committed completion. Check it, never replay the action.
      const existing = await prisma.runAction.findUnique({ where: { id } });
      if (!existing || existing.status !== data.status || existing.completedSimulatedSeconds !== (data.completedSimulatedSeconds ?? null) ||
          existing.completedAt?.toISOString() !== data.completedAt?.toISOString()) throw new Error("Action acknowledgement is inconsistent");
    }
    if (data.status !== "running") instance.actions.delete(id);
  };
  await flushAcknowledgement(instance);
}
