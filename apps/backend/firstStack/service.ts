import { randomUUID } from "node:crypto";
import { requireCapability } from "../capabilities/policy";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors";
import { canonical, designRevision, hash, withoutSidecar } from "./canonical";
import { reviewSidecar } from "./authoring";
import { firstStackLimits } from "@infraforge/contracts/first-stack";
import { prepareFirstStackExecution } from "./execution";

export interface FirstStackDesign {
  id: string; name: string; ownerId: string; layout: Record<string, unknown>;
  updatedAt: Date; challengeId: string | null;
}
export interface FirstStackTransaction {
  owned(id: string, owner: string): Promise<FirstStackDesign | null>;
  update(id: string, owner: string, layout: Record<string, unknown>): Promise<FirstStackDesign>;
  create(row: { id: string; name: string; ownerId: string; layout: Record<string, unknown> }): Promise<FirstStackDesign>;
}
export interface FirstStackRepository { transaction<T>(task: (tx: FirstStackTransaction) => Promise<T>): Promise<T> }
export class FirstStackRefusal extends Error {
  constructor(readonly diagnostics: Array<{ code: string; path: string; message: string }>) { super("First stack review refused"); }
}
export function createFirstStackService(repository: FirstStackRepository, capability = requireCapability) {
  const bounded = (value: unknown) => {
    if (Buffer.byteLength(canonical(value)) > firstStackLimits.semanticBytes) throw new ValidationError("Semantic byte budget exceeded");
  };
  const owned = async (tx: FirstStackTransaction, owner: string, id: string, expected: string) => {
    const row = await tx.owned(id, owner);
    if (!row || row.ownerId !== owner) throw new NotFoundError("Saved design not available");
    if (row.updatedAt.toISOString() !== expected) throw new ConflictError("Saved design changed; refresh its revision.");
    if (row.challengeId) throw new ValidationError("Fixed challenge inputs cannot be changed through first-stack authoring");
    return row;
  };
  return {
    async compile(owner: string, id: string, expected: string, workload: unknown, policy: unknown) {
      bounded({ workload, policy });
      return repository.transaction(async tx => {
        const row = await owned(tx, owner, id, expected);
        const prepared = prepareFirstStackExecution(owner, row.layout, row.layout.firstStack, workload, policy, capability);
        return { executable: false as const, lock: prepared.lock, compiled: prepared.compiled };
      });
    },
    async review(owner: string, id: string, expected: string, candidate?: unknown) {
      bounded(candidate ?? null);
      return repository.transaction(async tx => {
        const row = await owned(tx, owner, id, expected);
        const result = reviewSidecar(row.layout, candidate ?? row.layout.firstStack);
        return { ...result, designRevision: designRevision(row.layout), updatedAt: row.updatedAt.toISOString() };
      });
    },
    async save(owner: string, id: string, expected: string, candidate: unknown, copy: boolean) {
      bounded(candidate ?? null);
      return repository.transaction(async tx => {
        const row = await owned(tx, owner, id, expected);
        const review = reviewSidecar(row.layout, candidate);
        if (!review.ok) throw new FirstStackRefusal(review.diagnostics);
        const sidecar = copy ? { ...review.sidecar, migration: { kind: "reviewed-copy" as const,
          fromInfrastructureId: row.id, fromRevision: designRevision(row.layout), reviewedBy: owner } } : review.sidecar;
        if (!copy && sidecar.migration && (sidecar.migration.reviewedBy !== owner || !row.layout.firstStack || hash(sidecar) !== hash(row.layout.firstStack))) throw new ValidationError("Migration provenance is server-owned; use the reviewed-copy endpoint");
        if (!copy && row.layout.firstStack !== undefined) {
          if (hash(row.layout.firstStack) !== hash(sidecar)) throw new ConflictError("The saved sidecar is immutable; make an explicit reviewed copy.");
          return row;
        }
        const layout = { ...withoutSidecar(row.layout), firstStack: sidecar };
        bounded(layout);
        capability(owner, { capability: "design.persist", operation: copy ? "create" : "update", countDelta: copy ? 1 : 0 });
        return copy ? tx.create({ id: randomUUID(), ownerId: owner, name: `${row.name} (reviewed copy)`, layout }) : tx.update(row.id, owner, layout);
      });
    },
  };
}
