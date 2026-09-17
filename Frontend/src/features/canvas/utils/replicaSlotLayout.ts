import {
  NODE_CARD_WIDTH,
  NODE_CARD_HEIGHT,
} from "@/features/monitoring/components/MonitoringDashboardCard";
import type { Resource } from "@shared/interface/Resource.interface";
import type { SpawnedVmInfo } from "@shared/interface/SpawnedVmInfo.interface";
import type { PoolSnapshot } from "@shared/interface/PoolSnapshot.interface";

/* Canvas-slot layout for engine-owned autoscaled replicas. The engine emits
a fixed downward stack (spawnOrigin + SPAWN_Y_GAP * n), which leaves ugly
holes once drain cycles punch gaps in it. Here replicas are re-scattered
onto grid-aligned FREE slots near their pool: deterministic per replica id
(stable across 1Hz snapshots), never overlapping a canvas card or another
replica, and tidy because every slot snaps to the slot grid. Pure, zero I/O.
Render-side only: the engine never consumes replica coordinates back. */

const SLOT_W = NODE_CARD_WIDTH + 32; // 240px column step
const SLOT_H = NODE_CARD_HEIGHT + 32; // 192px row step
const PACK_GAP = 32; // breathing room kept between card faces

// Candidate offsets (in slot units) around the pool anchor, tried in a
// per-replica shuffled order so neighbours scatter instead of stacking.
const RING_OFFSETS: Array<[number, number]> = [
  [0, 1], [1, 0], [1, 1], [0, -1], [1, -1], [-1, 1], [2, 0], [2, 1],
  [1, 2], [0, 2], [-1, 0], [2, -1], [1, -2], [-1, -1], [0, -2], [-1, 2],
  [2, 2], [-1, -2], [-2, 1], [-2, 0], [3, 0], [2, -2], [-2, 2], [3, 1],
  [1, 3], [0, 3], [-1, 3], [3, -1], [2, 3], [-2, -1], [-2, -2], [3, 2],
];

function hashSeed(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates with the replica's own seed: same id -> same try-order
// forever, so a replica never jumps between snapshots.
function candidateOrder(seed: number): Array<[number, number]> {
  const list = [...RING_OFFSETS];
  const rng = mulberry32(seed);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}

function cardsOverlap(aX: number, aY: number, bX: number, bY: number): boolean {
  return (
    Math.abs(aX - bX) < NODE_CARD_WIDTH + PACK_GAP &&
    Math.abs(aY - bY) < NODE_CARD_HEIGHT + PACK_GAP
  );
}

/* Anchor = the pool's base-VM corner (right-most / lowest base card), so a
pool's replicas scatter around their own family instead of drifting across
the canvas. Falls back to the engine position when the base is gone. */
function poolAnchor(
  pool: PoolSnapshot | undefined,
  resources: Resource[],
  fallback: SpawnedVmInfo,
): { x: number; y: number } {
  if (!pool) return { x: fallback.x, y: fallback.y };
  const baseVms = resources.filter((r) => pool.baseVmIds.includes(r.id));
  if (baseVms.length === 0) return { x: fallback.x, y: fallback.y };
  return {
    x: Math.max(...baseVms.map((r) => r.x)),
    y: Math.max(...baseVms.map((r) => r.y)),
  };
}

export function replicaSlotPositions(
  spawnedVms: SpawnedVmInfo[],
  resources: Resource[],
  pools: Record<string, PoolSnapshot>,
): Map<string, { x: number; y: number }> {
  const taken: Array<{ x: number; y: number }> = resources.map((r) => ({
    x: r.x,
    y: r.y,
  }));
  // Stable placement order: spawn time, then id — never snapshot order.
  const order = [...spawnedVms].sort(
    (a, b) => a.spawnedAtTick - b.spawnedAtTick || a.id.localeCompare(b.id),
  );
  const positions = new Map<string, { x: number; y: number }>();
  for (const vm of order) {
    const anchor = poolAnchor(pools[vm.poolId], resources, vm);
    let chosen = { x: anchor.x, y: anchor.y + SLOT_H };
    for (const [cx, cy] of candidateOrder(hashSeed(vm.id))) {
      const px = anchor.x + cx * SLOT_W;
      const py = anchor.y + cy * SLOT_H;
      if (!taken.some((t) => cardsOverlap(t.x, t.y, px, py))) {
        chosen = { x: px, y: py };
        break;
      }
    }
    taken.push(chosen);
    positions.set(vm.id, chosen);
  }
  return positions;
}