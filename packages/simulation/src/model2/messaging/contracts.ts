import type { Quantity } from "../../reality/quantity";
import type { ComputeResource } from "../compute/contracts";
export interface ServiceDemand { cpu: Quantity<"cpu-us">; wait: Quantity<"us"> }
export interface CommandConfig { execution: ComputeResource; concurrency: Quantity<"count">; pending: Quantity<"count">; timeout: Quantity<"us">; demands: Record<string, ServiceDemand> }
export interface MessageBody { key: string; namespace: string; objectKey: string; bytes: number }
