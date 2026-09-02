import { memo } from "react";
import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import { ResourceSidebarItem } from "./ResourceSidebarItem";

export const ResourceSidebar = memo(function ResourceSidebar() {
  return (
    <div className="w-16 h-full bg-gray-950 border-r border-gray-800 flex flex-col items-center gap-4 pt-4">
      {/* Entry Points — user-facing, first touch */}
      <ResourceSidebarItem label={RESOURCE_TYPES.DNS} />
      <ResourceSidebarItem label={RESOURCE_TYPES.CDN} />

      {/* Traffic Management */}
      <ResourceSidebarItem label={RESOURCE_TYPES.Firewall} />
      <ResourceSidebarItem label={RESOURCE_TYPES.LoadBalancer} />

      {/* Compute */}
      <ResourceSidebarItem label={RESOURCE_TYPES.VirtualMachine} />
      <ResourceSidebarItem label={RESOURCE_TYPES.ContainerRegistry} />

      {/* Data Layer */}
      <ResourceSidebarItem label={RESOURCE_TYPES.Cache} />
      <ResourceSidebarItem label={RESOURCE_TYPES.Database} />
      <ResourceSidebarItem label={RESOURCE_TYPES.ObjectStorage} />

      {/* Async & Messaging */}
      <ResourceSidebarItem label={RESOURCE_TYPES.MessageQueue} />

      {/* Observability */}
      <ResourceSidebarItem label={RESOURCE_TYPES.MonitoringAgent} />
    </div>
  )
});