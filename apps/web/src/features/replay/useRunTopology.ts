import { useCallback, useMemo } from "react";
import type { RunReport } from "@infraforge/contracts/reports";
import { getSpecificDeployment } from "@/api/deployment.api";
import { useRequest } from "@/api/useRequest";
import type { TierEdge, TierNode } from "@/features/timetable/tiers";

export interface RunTopologyView { nodes: TierNode[]; edges: TierEdge[]; connectionsKnown: boolean; loading: boolean }

/* The architecture that actually ran: the immutable run input when it was captured,
otherwise the report's resource list without connections (an older run). */
export function useRunTopology(report: RunReport): RunTopologyView {
  const id = report.run.id;
  const load = useCallback(() => getSpecificDeployment(id), [id]);
  const { data, loading } = useRequest(load);
  const listed = report.topology.original?.resources;
  return useMemo(() => {
    const input = data?.runInputs ?? null;
    if (input) return {
      nodes: input.resources.map((r) => ({ id: r.id, type: r.type, label: r.name ?? r.id })),
      edges: input.connectionLines.map((c) => ({ source: c.sourceId, target: c.targetId })),
      connectionsKnown: true, loading: false,
    };
    return { nodes: (listed ?? []).map((r) => ({ id: r.id, type: r.type, label: r.name })), edges: [], connectionsKnown: false, loading };
  }, [data, listed, loading]);
}
