import { magnetRadius, speedFor } from '../../config';
import { angleDiff } from '../../math';
import type { Rng } from '../../rng';
import type { Snake } from '../Snake';
import type { World } from '../World';

export const BotStyle = {
  Passive: 0,
  Normal: 1,
  Aggressive: 2,
} as const;
export type BotStyle = (typeof BotStyle)[keyof typeof BotStyle];

interface StyleParams {
  /** Karar aralığı (tick). */
  reaction: number;
  /** Önündeki tehlikeye bakış mesafesi çarpanı. */
  caution: number;
  /** Yüksek değerli yem için boost olasılığı. */
  foodBoost: number;
  /** Her kararda saldırı hedefi arama olasılığı. */
  attack: number;
}

const STYLES: Record<BotStyle, StyleParams> = {
  [BotStyle.Passive]: { reaction: 6, caution: 1.3, foodBoost: 0.05, attack: 0 },
  [BotStyle.Normal]: { reaction: 4, caution: 1.0, foodBoost: 0.25, attack: 0.25 },
  [BotStyle.Aggressive]: { reaction: 3, caution: 0.8, foodBoost: 0.5, attack: 0.9 },
};

const RAY_COUNT = 16;

interface Goal {
  angle: number;
  boost: boolean;
}

/**
 * Basit bot zekâsı: önce tehlikeden kaçınır, sonra (bazen) daha küçük yılanların önünü keser,
 * aksi halde en değerli yakın yeme yönelir; hiçbir şey yoksa merkez yönünde dolaşır.
 */
export class BotBrain {
  private nextThink = 0;
  private wander: number;
  private readonly params: StyleParams;
  private readonly foodScratch: number[] = [];

  constructor(
    readonly snakeId: number,
    readonly style: BotStyle,
    private readonly rng: Rng,
  ) {
    this.params = STYLES[style];
    this.wander = rng.range(-Math.PI, Math.PI);
  }

  think(world: World, s: Snake): void {
    if (world.tick < this.nextThink) return;
    this.nextThink = world.tick + this.params.reaction + this.rng.int(0, 2);

    const goal = this.chooseGoal(world, s);
    const look =
      (s.radius * 10 + speedFor(world.cfg, s.radius, goal.boost) * 0.6) * this.params.caution;

    if (rayClearance(world, s, goal.angle, look) < look) {
      // İstenen yön kapalı: tüm yönleri tara, açık ve hedefe yakın olanı seç
      let bestAngle = goal.angle;
      let bestScore = -Infinity;
      let bestClear = 0;
      for (let k = 0; k < RAY_COUNT; k++) {
        const a = s.angle + ((k - RAY_COUNT / 2) / RAY_COUNT) * Math.PI * 2;
        const clear = rayClearance(world, s, a, look);
        const score =
          (clear / look) * 3 +
          Math.cos(angleDiff(a, goal.angle)) -
          Math.abs(angleDiff(s.angle, a)) * 0.25;
        if (score > bestScore) {
          bestScore = score;
          bestAngle = a;
          bestClear = clear;
        }
      }
      goal.angle = bestAngle;
      if (bestClear < s.radius * 4) goal.boost = false;
    }

    world.setInput(s.id, goal.angle + this.rng.range(-0.08, 0.08), goal.boost);
  }

  private chooseGoal(world: World, s: Snake): Goal {
    const cfg = world.cfg;
    const R = cfg.arenaRadius;
    const distCenter = Math.sqrt(s.x * s.x + s.y * s.y);

    // Sınıra çok yaklaştıysa önce içeri dön
    if (distCenter > R - s.radius * 8 - 250) {
      return { angle: Math.atan2(-s.y, -s.x) + this.rng.range(-0.6, 0.6), boost: false };
    }

    if (s.score > 40 && this.rng.chance(this.params.attack)) {
      const attack = this.findAttack(world, s);
      if (attack) return attack;
    }

    const food = this.findFood(world, s);
    if (food) return food;

    this.wander += this.rng.range(-0.35, 0.35);
    if (distCenter > R * 0.6) {
      this.wander = Math.atan2(-s.y, -s.x) + this.rng.range(-0.5, 0.5);
    }
    return { angle: this.wander, boost: false };
  }

  /** Yakındaki daha küçük bir yılanın kafasının önüne geç. */
  private findAttack(world: World, s: Snake): Goal | null {
    const range = 450 + s.radius * 4;
    let target: Snake | null = null;
    let bestD = range;
    for (const o of world.snakeList) {
      if (o.id === s.id || o.score > s.score * 0.8) continue;
      const dx = o.x - s.x;
      const dy = o.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) {
        bestD = d;
        target = o;
      }
    }
    if (!target) return null;
    const lead = target.radius * 4 + 60;
    const ax = target.x + Math.cos(target.angle) * lead;
    const ay = target.y + Math.sin(target.angle) * lead;
    return {
      angle: Math.atan2(ay - s.y, ax - s.x),
      boost: bestD < 320 && s.score > 60,
    };
  }

  /** Değer / mesafe oranı en iyi, önüne düşen yemi seç. */
  private findFood(world: World, s: Snake): Goal | null {
    const food = world.food;
    const vision = 220 + s.radius * 6;
    const safeR = world.cfg.arenaRadius - s.radius * 5;
    const out = this.foodScratch;
    const n = food.query(s.x, s.y, vision, out);
    let best = -1;
    let bestScore = 0;
    let bestD = 0;
    let bestAngle = 0;
    for (let k = 0; k < n; k++) {
      const slot = out[k]!;
      if (!food.alive[slot]) continue;
      const fx = food.x[slot]!;
      const fy = food.y[slot]!;
      if (fx * fx + fy * fy > safeR * safeR) continue;
      const dx = fx - s.x;
      const dy = fy - s.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > vision) continue;
      const a = Math.atan2(dy, dx);
      const score = (food.value[slot]! / (d + 30)) * (1 + 0.6 * Math.cos(angleDiff(s.angle, a)));
      if (score > bestScore) {
        bestScore = score;
        best = slot;
        bestD = d;
        bestAngle = a;
      }
    }
    if (best < 0) return null;
    const rich = food.value[best]! >= 3 && bestD > magnetRadius(world.cfg, s.radius);
    return {
      angle: bestAngle,
      boost: rich && bestD < 220 && s.score > 25 && this.rng.chance(this.params.foodBoost),
    };
  }
}

/** `angle` yönünde, `maxDist`e kadar ilk engele (başka yılan veya sınır) olan mesafe. */
export function rayClearance(world: World, s: Snake, angle: number, maxDist: number): number {
  const grid = world.grid;
  const R = world.cfg.arenaRadius;
  const cx = Math.cos(angle);
  const cy = Math.sin(angle);
  const step = Math.max(10, s.radius);
  const queryR = s.radius + grid.maxRadius + 6;
  for (let d = step * 0.5; d <= maxDist; d += step) {
    const px = s.x + cx * d;
    const py = s.y + cy * d;
    if (Math.sqrt(px * px + py * py) + s.radius >= R - 20) return d;
    const n = grid.query(px, py, queryR);
    const hits = grid.hits;
    for (let k = 0; k < n; k++) {
      const i = hits[k]!;
      if (grid.sOwner[i] === s.id) continue;
      let rr = s.radius + grid.sr[i]! + 6;
      // Başka kafalar hareket ediyor: çevrelerine daha geniş pay bırak
      if (grid.sArc[i]! < grid.sr[i]! * 2) rr += 30 + grid.sr[i]!;
      const dx = grid.sx[i]! - px;
      const dy = grid.sy[i]! - py;
      if (dx * dx + dy * dy < rr * rr) return d;
    }
  }
  return maxDist;
}
