import { prisma } from "../lib/prisma";
import { reportSelection } from "../reports/routes";
import type { LearningRun } from "./progress";

// Same report projection as challenge history; full actions match the comparison route.
export const learningAttemptSelection = { ...reportSelection, ownerId: true,
  actions: { orderBy: { sequence: "asc" }, take: 501 } } as const;
export interface LearningAttemptQuery {
  where: { ownerId: string; challengeId: { in: string[] } };
  select: typeof learningAttemptSelection;
  orderBy: [{ createdAt: "desc" }, { id: "desc" }];
}
export interface LearningAttemptDatabase {
  deployment: { findMany(query: LearningAttemptQuery): Promise<(LearningRun & { _count: { actions: number } })[]> };
}

/** All saved attempts for visible labs, not a recent history window that can lose a met result. */
export async function readLearningAttempts(ownerId: string, challengeIds: readonly string[],
  database: LearningAttemptDatabase = { deployment: { findMany: (query) => prisma.deployment.findMany(query) } }): Promise<LearningRun[]> {
  if (!challengeIds.length) return [];
  const rows = await database.deployment.findMany({ where: { ownerId, challengeId: { in: [...new Set(challengeIds)] } },
    select: learningAttemptSelection, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  return rows.map((row) => ({ ...row, actionCount: row._count.actions }));
}
