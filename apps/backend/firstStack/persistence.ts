import { prisma } from "../lib/prisma";
import type { Prisma } from "../lib/generated/prisma/client";
import type { FirstStackRepository, FirstStackDesign } from "./service";

const design = (row: { id: string; name: string; ownerId: string | null; layout: unknown; updatedAt: Date; challengeId: string | null }): FirstStackDesign =>
  ({ ...row, ownerId: row.ownerId!, layout: row.layout as Record<string, unknown> });
export const firstStackRepository: FirstStackRepository = {
  transaction: task => prisma.$transaction(async tx => task({
    owned: async (id, ownerId) => {
      await tx.$queryRaw`SELECT id FROM "Infrastructure" WHERE id = ${id} AND "ownerId" = ${ownerId} FOR UPDATE`;
      const row = await tx.infrastructure.findUnique({ where: { id, ownerId } });
      return row ? design(row) : null;
    },
    update: async (id, ownerId, layout) => design(await tx.infrastructure.update({ where: { id, ownerId }, data: { layout: layout as Prisma.InputJsonObject } })),
    create: async row => design(await tx.infrastructure.create({ data: { ...row, userId: row.ownerId, layout: row.layout as Prisma.InputJsonObject } })),
  })),
};
