import type { ApplicationFlow } from "./ApplicationFlow.interface";
import type { DataKeyspace } from "./DataKeyspace.interface";
import type { CachePolicy } from "./CachePolicy.interface";
import type { MonitoringPolicy } from "./MonitoringPolicy.interface";
import type { CdnCachePolicy } from "./CdnCachePolicy.interface";
import type { VmCpuQuota } from "./VmCpuQuota.interface";
import type { VmExecution } from "./VmExecution.interface";
import type { DbConcurrency } from "./DbConcurrency.interface";
import type { LbAdmission } from "./LbAdmission.interface";
import type { LbHealth } from "./LbHealth.interface";
import type { CircuitBreakerSettings } from "./CircuitBreakerSettings.interface";
import type { ResourceType } from "./RESOURCE_TYPES.constants";
import type { AutoscalingPolicy } from "./AutoscalingPolicy.interface";
import type { RetrySettings } from "./RetrySettings.interface";
import type { ListenerSettings, FirewallSettings } from "./SecuritySettings.interface";

import type { AsyncQueueSettings, AsyncWorkerSettings } from "./AsyncSettings.interface";

import type { ObjectStoragePolicy } from "./ObjectStoragePolicy.interface";

import type { FirewallCapacity } from "./FirewallCapacity.interface";

import type { DatabaseReplication } from "./DatabaseReplication.interface";

export interface Resource {
  databaseReplication?: DatabaseReplication;
  firewallCapacity?: FirewallCapacity;
  objectStoragePolicy?: ObjectStoragePolicy;
  dataKeyspace?: DataKeyspace;
  cachePolicy?: CachePolicy;
  cdnCachePolicy?: CdnCachePolicy;
  monitoringPolicy?: MonitoringPolicy;
  dbConcurrency?: DbConcurrency;
  vmExecution?: VmExecution;
  vmCpuQuota?: VmCpuQuota;
  lbAdmission?: LbAdmission;
  lbHealth?: LbHealth;
  listenerSettings?: ListenerSettings;
  firewallSettings?: FirewallSettings;
  applicationFlow?: ApplicationFlow;
  asyncQueue?: AsyncQueueSettings;
  asyncWorker?: AsyncWorkerSettings;
  id: string;
  type: ResourceType;
  x: number;
  y: number;
  skuId?: string;                  // provider SKU from the catalog (Era 1)
  autoscaling?: AutoscalingPolicy; // pool policy when this resource anchors a VM pool
  circuitBreaker?: CircuitBreakerSettings;
  retry?: RetrySettings;
  public?: boolean;
  encryption?: boolean;
  openPorts?: number[];
  size?: "small" | "medium" | "large";
  region?: string;
  name?: string;
}
