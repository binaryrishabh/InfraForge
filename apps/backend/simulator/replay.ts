import { prisma } from "../lib/prisma";
import { storedJson } from "../utils/json";
import { currentSecond } from "./engineView";
import type { SimulationInstance } from "./instance";

/* Records every submitted browser action that is due at the replay's current second as a run action, in the
browser's order. The normal action path then applies it at this same second, exactly as the browser did. A lost
reply is safe: the actions already recorded for this run are counted, so none is recorded twice. */
export async function recordReplayActions(deploymentId: string, instance: SimulationInstance) {
  const replay = instance.replay!, second = currentSecond(instance);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Deployment" WHERE id = ${deploymentId} FOR UPDATE`;
    // Browser runs with actions are never challenge attempts, so these kinds are only ever submitted actions here.
    const recorded = await tx.runAction.count({ where: { deploymentId, kind: { in: ["load", "chaos", "pool-scale"] } } });
    replay.next = Math.max(replay.next, recorded);
    while (replay.next < replay.actions.length && replay.actions[replay.next]!.atSecond <= second) {
      const { request } = replay.actions[replay.next]!;
      const run = await tx.deployment.update({ where: { id: deploymentId }, data: { actionSequence: { increment: 1 } } });
      await tx.runAction.create({ data: { deploymentId, sequence: run.actionSequence, kind: request.kind, requestedAt: new Date(), parameters: storedJson(request.parameters) } });
      replay.next++;
    }
  });
}
