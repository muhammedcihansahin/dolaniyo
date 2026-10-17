import { TAU } from '../math';
import type { World } from './World';

export interface SpawnPoint {
  x: number;
  y: number;
  angle: number;
}

/** Diğer yılanlardan ve sınırdan yeterince uzak rastgele bir doğma noktası arar. */
export function findSpawnPoint(world: World): SpawnPoint {
  const { cfg, rng } = world;
  const maxR = Math.min(
    cfg.arenaRadius * cfg.spawnRadiusFrac,
    cfg.arenaRadius - cfg.spawnMinBorderDist,
  );
  let bestX = 0;
  let bestY = 0;
  let bestClear = -1;
  for (let t = 0; t < cfg.spawnTries; t++) {
    const rr = maxR * Math.sqrt(rng.next());
    const th = rng.next() * TAU;
    const x = Math.cos(th) * rr;
    const y = Math.sin(th) * rr;
    const clear = clearance(world, x, y, cfg.spawnMinSnakeDist);
    if (clear > bestClear) {
      bestClear = clear;
      bestX = x;
      bestY = y;
    }
    if (clear >= cfg.spawnMinSnakeDist) break;
  }
  const toCenter = Math.atan2(-bestY, -bestX);
  return { x: bestX, y: bestY, angle: toCenter + rng.range(-Math.PI / 4, Math.PI / 4) };
}

/** (x, y)'den en yakın yılan parçasına mesafe, en fazla `limit`. */
function clearance(world: World, x: number, y: number, limit: number): number {
  let best = limit;
  const grid = world.grid;
  const n = grid.query(x, y, limit);
  const hits = grid.hits;
  for (let k = 0; k < n; k++) {
    const i = hits[k]!;
    const dx = grid.sx[i]! - x;
    const dy = grid.sy[i]! - y;
    const d = Math.sqrt(dx * dx + dy * dy) - grid.sr[i]!;
    if (d < best) best = d;
  }
  // Bu tick eklenmiş, henüz ızgarada olmayan yılanlar
  for (const s of world.snakeList) {
    if (s.spawnTick !== world.tick) continue;
    const dx = s.x - x;
    const dy = s.y - y;
    const d = Math.sqrt(dx * dx + dy * dy) - s.length;
    if (d < best) best = d;
  }
  return Math.max(0, best);
}
