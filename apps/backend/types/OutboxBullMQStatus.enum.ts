export enum OutboxBullMQStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed"
}

export type OutboxBullMQStatusType = (typeof OutboxBullMQStatus)[keyof typeof OutboxBullMQStatus];