import type { CommandConfig, MessageBody } from "../async/contracts";
import type { Quantity } from "../../reality/quantity";

export interface EventBusConfig extends CommandConfig {
  id: string;
  kind: "event-bus";
  profile: "independent-pubsub/1";
  subscriptions: Array<{ id: string; target: string; keyPrefix?: string }>;
  capacityMessages: Quantity<"count">;
  maxAttempts: Quantity<"count">;
  retryDelay: Quantity<"us">;
  deliveryTimeout: Quantity<"us">;
  deadLetterCapacity: Quantity<"count">;
}
export interface EventPublish { kind: "publish"; logicalId: string; body: MessageBody; delayUs?: number }
