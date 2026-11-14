import type { LearningModule } from "@infraforge/contracts/learning";
import { orderTheRowLocks } from "./lessons/order-the-row-locks";

export const transactionLockingLessons = [orderTheRowLocks];
export const transactionLocking: LearningModule = {
  id: "transaction-locking", availability: "available", title: "Locks, not capacity",
  summary: "See how two writes that take the same rows in opposite order wait for each other, and how one fixed order makes that impossible.",
  lessonIds: transactionLockingLessons.map(l => l.id),
};
