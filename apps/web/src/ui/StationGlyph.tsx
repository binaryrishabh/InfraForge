import { RESOURCE_TYPES, type ResourceType } from "@infraforge/domain/resource";

/* Station pictograms, drawn on a 16-unit grid with one stroke weight. Each shows what the
resource does in the system (names to addresses, fan-out, a stopping wall, a cylinder of
records) rather than a vendor product, so no glyph implies a particular cloud. */
const PATHS: Record<ResourceType, string> = {
  [RESOURCE_TYPES.DNS]: "M2.5 8h6.2M6.4 5.6 8.8 8l-2.4 2.4M12.5 8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  [RESOURCE_TYPES.CDN]: "M8 8 3.6 4.4M8 8l4.4-3.6M8 8v4.6M8 8m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M3 4m-1.2 0a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M13 4m-1.2 0a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M8 13.4m-1.2 0a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0",
  [RESOURCE_TYPES.Firewall]: "M2.5 3.5h11v9h-11zM2.5 6.5h11M2.5 9.5h11M6 3.5v3M10 6.5v3M6 9.5v3",
  [RESOURCE_TYPES.LoadBalancer]: "M1.8 8h4.4M6.2 8 13.6 3.6M6.2 8h7.4M6.2 8l7.4 4.4",
  [RESOURCE_TYPES.VirtualMachine]: "M2.5 2.8h11v10.4h-11zM2.5 6.3h11M2.5 9.7h11M4.6 4.55h1.4M4.6 8h1.4M4.6 11.45h1.4",
  [RESOURCE_TYPES.ContainerRegistry]: "M2.6 3h10.8v3.2H2.6zM2.6 6.4h10.8v3.2H2.6zM2.6 9.8h10.8V13H2.6z",
  [RESOURCE_TYPES.Cache]: "M4 4h8v8H4zM6 2v2M10 2v2M6 12v2M10 12v2M2 6h2M2 10h2M12 6h2M12 10h2M6.4 6.4h3.2v3.2H6.4z",
  [RESOURCE_TYPES.Database]: "M3 4.2c0-1.2 2.2-1.9 5-1.9s5 .7 5 1.9-2.2 1.9-5 1.9-5-.7-5-1.9zM3 4.2v7.6c0 1.2 2.2 1.9 5 1.9s5-.7 5-1.9V4.2M3 8c0 1.2 2.2 1.9 5 1.9s5-.7 5-1.9",
  [RESOURCE_TYPES.ObjectStorage]: "M2.8 4.6c0-1 2.3-1.6 5.2-1.6s5.2.6 5.2 1.6-2.3 1.6-5.2 1.6-5.2-.6-5.2-1.6zM2.8 4.6l1.4 8c.2.8 1.8 1.2 3.8 1.2s3.6-.4 3.8-1.2l1.4-8",
  [RESOURCE_TYPES.MessageQueue]: "M1.8 5h12.4v6H1.8zM4.2 7v2M6.6 7v2M9 7v2M11.4 7v2",
  [RESOURCE_TYPES.MonitoringAgent]: "M1.6 8.6h3l1.6-4.2 2.4 7.2 1.8-4.2h4",
};

// Not a resource: whoever sends the requests, drawn as an arrow leaving a bar.
const CALLER = "M3 3v10M5.5 8h8M10.5 5l3 3-3 3";

export function StationGlyph({ type, size = 16, className, title }: { type: ResourceType | string; size?: number; className?: string; title?: string }) {
  const d = type === "Caller" ? CALLER : PATHS[type as ResourceType] ?? PATHS[RESOURCE_TYPES.VirtualMachine];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round"
      className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path d={d} />
    </svg>
  );
}
