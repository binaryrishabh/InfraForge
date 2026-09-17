import {
  NODE_CARD_WIDTH,
  NODE_CARD_HEIGHT,
} from "@/features/monitoring/components/MonitoringDashboardCard";

/* Canvas-slot placement for engine-owned autoscaled replicas. The engine
emits a fixed downward stack (spawnOrigin + SPAWN_Y_GAP * n); here each
replica is scattered ONCE, at first sight, onto a grid-aligned free slot
near its engine position, and that slot is then frozen in canvasStore —
dragging a base VM never drags its replicas along, and drained replicas
leave no holes because nothing is recomputed from anchors afterwards.
Pure, zero I/O. */

const SLOT_W = NODE_CARD_WIDTH + 32; // 240px column step
const SLOT_H = NODE_CARD_HEIGHT + 32; // 192px row step
const PACK_GAP = 32; // breathing room kept between card faces
const GRID_SIZE = 24;

// Candidate offsets (in slot units) around the origin, tried in a
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
// forever, so placement is deterministic across snapshots.
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

/* First free grid-snapped slot near (originX, originY) — the engine's own
spawn position — avoiding every rect in `taken` (canvas cards plus already
placed replicas). Falls back to one row below the origin if the ring is
somehow exhausted. */
export function findFreeReplicaSlot(
  vmId: string,
  originX: number,
  originY: number,
  taken: Array<{ x: number; y: number }>,
): { x: number; y: number } {
  let chosen = { x: originX, y: originY + SLOT_H };
  for (const [cx, cy] of candidateOrder(hashSeed(vmId))) {
    const px = Math.round((originX + cx * SLOT_W) / GRID_SIZE) * GRID_SIZE;
    const py = Math.round((originY + cy * SLOT_H) / GRID_SIZE) * GRID_SIZE;
    if (!taken.some((t) => cardsOverlap(t.x, t.y, px, py))) {
      chosen = { x: px, y: py };
      break;
    }
  }
  return chosen;
}