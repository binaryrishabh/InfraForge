import {
  RESOURCE_TYPES,
  type ResourceType,
} from "@shared/constants/RESOURCE_TYPES.constants";
import {
  Database,
  Globe,
  Archive,
  Network,
  Package,
  Radio,
  Server,
  Shield,
  Zap,
  Activity,
  Mail,
  type LucideIcon,
} from "lucide-react";

const ResourceIconMap: Record<ResourceType, LucideIcon> = {
  [RESOURCE_TYPES.DNS]: Globe,
  [RESOURCE_TYPES.CDN]: Radio,
  [RESOURCE_TYPES.Firewall]: Shield,
  [RESOURCE_TYPES.LoadBalancer]: Network,
  [RESOURCE_TYPES.VirtualMachine]: Server,
  [RESOURCE_TYPES.ContainerRegistry]: Package,
  [RESOURCE_TYPES.Cache]: Zap,
  [RESOURCE_TYPES.Database]: Database,
  // lucide-react@1.31 ships no `Bucket` export (build error TS2305), so the
  // object-storage badge wears Archive — the closest existing "stored objects"
  // glyph — until a real bucket icon lands in the installed icon set.
  [RESOURCE_TYPES.ObjectStorage]: Archive,
  [RESOURCE_TYPES.MessageQueue]: Mail,
  [RESOURCE_TYPES.MonitoringAgent]: Activity,
};

interface ResourceIconProps {
  type: ResourceType;
  size?: number;
  className?: string;
}

export function ResourceIcon({
  type,
  size = 20,
  className,
}: ResourceIconProps) {
  const IconComponent = ResourceIconMap[type] ?? Server;
  return (
    <IconComponent
      size={size}
      strokeWidth={1.75}
      className={className ?? "text-gray-400"}
    ></IconComponent>
  );
}
