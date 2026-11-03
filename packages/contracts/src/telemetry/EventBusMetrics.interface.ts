export interface EventBusMetrics {
  version: 1;
  accepted: number;
  invalid: number;
  subscriptions: Array<{ id: string; target: string; accepted: number; delivered: number; retried: number; discarded: number; filtered: number; pending: number; deadLettered: number; deadLetterOverflow: number }>;
}
