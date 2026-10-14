import { RESOURCE_PORTS, type Resource, type ResourceType } from "@infraforge/domain/resource";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";

type Node = [id: string, type: ResourceType, column: number, row: number, extra?: Partial<Resource>];

// Lays starter nodes on the canvas's 24px grid; a connection's port is its target's listening port.
export function starter(nodes: Node[], edges: Array<[string, string]>): ChallengeStarter {
  const resources: Resource[] = nodes.map(([id, type, column, row, extra]) => ({ id, type, x: 48 + column * 256, y: 48 + row * 168, ...extra }));
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  const connectionLines = edges.map(([sourceId, targetId]) => {
    const source = byId.get(sourceId), target = byId.get(targetId);
    if (!source || !target) throw new Error(`Starter edge ${sourceId}→${targetId} references a missing resource`);
    return { id: `${sourceId}-${targetId}`, sourceId, targetId, sourceType: source.type, targetType: target.type, port: RESOURCE_PORTS[target.type] };
  });
  return { resources, connectionLines };
}

export const fanOut = (from: string, ids: string[]) => ids.map((id) => [from, id] as [string, string]);
export const fanIn = (ids: string[], to: string) => ids.map((id) => [id, to] as [string, string]);
