import { clientRetryError, type WorkloadProfile } from "@infraforge/domain/workload";
import type { ProductContract } from "./contracts";

export const CLIENT_RETRY_PROFILE = "client-retry/1";

export function compileClientRetry(p: WorkloadProfile, contract: ProductContract) {
  const error = clientRetryError(p.clientRetry); if (error) throw Error(error);
  if (!p.clientRetry) return;
  contract.clientRetry = { ...p.clientRetry };
  const flow = contract.applicationFlowProfile ? `/${contract.applicationFlowProfile}` : "";
  contract.version = (flow ? contract.version.slice(0, -flow.length) : contract.version) + `/${CLIENT_RETRY_PROFILE}` + flow;
}

export function checkClientRetry(p: WorkloadProfile, contract: ProductContract) {
  const error = clientRetryError(p.clientRetry) ?? clientRetryError(contract.clientRetry); if (error) throw Error(error);
  if (!!p.clientRetry !== !!contract.clientRetry || p.clientRetry?.version !== contract.clientRetry?.version ||
    p.clientRetry?.maxAttempts !== contract.clientRetry?.maxAttempts || p.clientRetry?.backoffMs !== contract.clientRetry?.backoffMs ||
    !!p.clientRetry !== contract.version.includes(`/${CLIENT_RETRY_PROFILE}`) ||
    (p.clientRetry && contract.failureCauseProfile !== "failure-cause/1")) throw Error("Client retries require matching captured client-retry/1 intent and failure-cause/1; only application reads retry.");
}
