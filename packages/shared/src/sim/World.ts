import { AMBIENT_FOOD_COLORS } from '../colors';
import {
  DT,
  bodyTrimMargin,
  foodRadius,
  lengthForScore,
  magnetRadius,
  makeConfig,
  radiusForScore,
  speedFor,
  turnRateFor,
  type SimConfig,
} from '../config';
import { TAU, angleDiff, clamp, normalizeAngle } from '../math';
import { Rng } from '../rng';
import { BodyGrid } from './BodyGrid';
import { FoodKind, FoodStore } from './FoodStore';
import { Snake } from './Snake';
import { findSpawnPoint } from './spawn';

export type DeathReason = 'border' | 'body' | 'head' | 'left';

export type SimEvent =
  | { type: 'spawned'; id: number }
  | {
      type: 'died';
      id: number;
      reason: DeathReason;
      /** Öldüren yılan; 0 = yok (sınır, ayrılma). */
      killerId: number;
      score: number;
      isBot: boolean;
    }
  | {
      type: 'foodEaten';
      foodId: number;
      x: number;
      y: number;
      color: number;
      radius: number;
      kind: FoodKind;
      eaterId: number;
    };

export interface AddSnakeOptions {
  name: string;
  color: number;
  isBot?: boolean;
  score?: number;
  /** Verilmezse güvenli bir doğma noktası aranır. */
  x?: number;
  y?: number;
  angle?: number;
}

interface Death {
  reason: DeathReason;
  killerId: number;
}

/**
 * Oyun dünyası: kuralların tek kaynağı. Sunucu bunu yetkili olarak, istemci çevrimdışı modda
 * aynen çalıştırır. `step()` sabit DT ile bir tick ilerletir (CURRENT_PLAN.md §8).
 */
export class World {
  readonly cfg: SimConfig;
  readonly rng: Rng;
  readonly food: FoodStore;
  readonly grid: BodyGrid;
  readonly snakes = new Map<number, Snake>();
  /** Canlı yılanlar, eklenme sırasıyla. */
  snakeList: Snake[] = [];
  tick = 0;
  /** Bu tick başında 1. sıradaki yılan (kafa-kafa kuralı için). */
  leaderId = 0;
  readonly ambientTarget: number;

  private events: SimEvent[] = [];
  private nextSnakeId = 1;
  private readonly trimMargin: number;
  private readonly scratch: number[] = [];
  private readonly tmp = { x: 0, y: 0 };
  /** Bu tick yenen ortam yemlerinin konumları (x, y çiftleri); yenileri bunların yakınında doğar. */
  private readonly eatenAmbient: number[] = [];

  constructor(cfg: Partial<SimConfig> = {}, seed = 1) {
    this.cfg = makeConfig(cfg);
    this.rng = new Rng(seed);
    const R = this.cfg.arenaRadius;
    this.food = new FoodStore(R, this.cfg.gridCellSize, 2048);
    this.grid = new BodyGrid(R, this.cfg.gridCellSize);
    this.ambientTarget = Math.floor(Math.PI * R * R * this.cfg.foodDensity);
    this.trimMargin = bodyTrimMargin(this.cfg);
    for (let i = 0; i < this.ambientTarget; i++) this.spawnAmbientFood();
  }

  addSnake(opts: AddSnakeOptions): Snake {
    const cfg = this.cfg;
    const s = new Snake(
      this.nextSnakeId++,
      opts.name,
      opts.color,
      opts.isBot ?? false,
      cfg.segmentSpacing,
    );
    s.score = opts.score ?? cfg.startScore;
    this.updateSize(s);
    let { x, y, angle } =
      opts.x !== undefined && opts.y !== undefined
        ? { x: opts.x, y: opts.y, angle: opts.angle ?? 0 }
        : findSpawnPoint(this);
    angle = normalizeAngle(angle);
    s.x = s.px = x;
    s.y = s.py = y;
    s.angle = s.pangle = s.targetAngle = angle;
    s.spawnTick = this.tick;
    s.body.reset(x, y, angle, s.length + this.trimMargin);
    this.snakes.set(s.id, s);
    this.snakeList.push(s);
    this.events.push({ type: 'spawned', id: s.id });
    return s;
  }

  /** Oyuncu ayrıldı: yılan ölmüş gibi yem bırakarak kaldırılır. */
  removeSnake(id: number): void {
    const s = this.snakes.get(id);
    if (!s) return;
    this.kill(s, 'left', 0);
    this.snakeList = this.snakeList.filter((o) => o.alive);
  }

  setInput(id: number, angle: number, boost: boolean): void {
    const s = this.snakes.get(id);
    if (!s || !Number.isFinite(angle)) return;
    s.targetAngle = normalizeAngle(angle);
    s.wantBoost = boost;
  }

  step(): void {
    this.tick++;
    this.food.tick = this.tick;
    this.updateLeader();
    const list = this.snakeList;
    for (let i = 0; i < list.length; i++) this.moveSnake(list[i]!);
    for (let i = 0; i < list.length; i++) this.eatFood(list[i]!);
    this.rebuildGrid();
    const deaths = this.detectCollisions();
    if (deaths.size > 0) {
      for (const [s, d] of deaths) this.kill(s, d.reason, d.killerId);
      this.snakeList = list.filter((s) => s.alive);
    }
    this.maintainFood();
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Skora göre sıralı ilk `n` yılan. */
  getLeaderboard(n: number): Snake[] {
    return [...this.snakeList]
      .sort((a, b) => b.score - a.score || a.spawnTick - b.spawnTick)
      .slice(0, n);
  }

  /** 1'den başlayan sıra; yılan yoksa 0. */
  rankOf(id: number): number {
    const s = this.snakes.get(id);
    if (!s) return 0;
    let rank = 1;
    for (const o of this.snakeList) {
      if (o.score > s.score || (o.score === s.score && o.spawnTick < s.spawnTick)) rank++;
    }
    return rank;
  }

  private updateSize(s: Snake): void {
    s.radius = radiusForScore(this.cfg, s.score);
    s.length = lengthForScore(this.cfg, s.score);
  }

  private updateLeader(): void {
    let best: Snake | null = null;
    for (const s of this.snakeList) if (!best || s.score > best.score) best = s;
    this.leaderId = best ? best.id : 0;
  }

  private moveSnake(s: Snake): void {
    const cfg = this.cfg;
    s.px = s.x;
    s.py = s.y;
    s.pangle = s.angle;

    s.boosting = s.wantBoost && s.score > cfg.boostMinScore;
    if (s.boosting) {
      const drain = Math.min(
        s.score - cfg.boostMinScore,
        (cfg.boostDrainBase + s.score * cfg.boostDrainK) * DT,
      );
      s.score -= drain;
      s.boostDropAcc += drain * cfg.boostDropRatio;
      const unit = clamp(s.score * cfg.boostDropUnitK, cfg.boostDropUnitMin, cfg.boostDropUnitMax);
      while (s.boostDropAcc >= unit) {
        s.boostDropAcc -= unit;
        this.dropBoostFood(s, unit);
      }
    }

    const maxTurn = turnRateFor(cfg, s.radius) * DT;
    s.angle = normalizeAngle(s.angle + clamp(angleDiff(s.angle, s.targetAngle), -maxTurn, maxTurn));
    const step = speedFor(cfg, s.radius, s.boosting) * DT;
    s.x += Math.cos(s.angle) * step;
    s.y += Math.sin(s.angle) * step;

    this.updateSize(s);
    s.body.advance(s.x, s.y);
    s.body.trim(s.x, s.y, s.length + this.trimMargin);
  }

  private dropBoostFood(s: Snake, value: number): void {
    const p = this.tmp;
    s.body.pointAt(s.x, s.y, s.length, p);
    const j = s.radius * 0.4;
    this.addFoodClamped(
      p.x + this.rng.range(-j, j),
      p.y + this.rng.range(-j, j),
      value,
      s.color,
      FoodKind.Boost,
      this.tick + this.cfg.boostFoodLifeTicks,
    );
  }

  private eatFood(s: Snake): void {
    const cfg = this.cfg;
    const food = this.food;
    const mr = magnetRadius(cfg, s.radius);
    const out = this.scratch;
    const n = food.query(s.x, s.y, mr + food.maxRadius, out);
    for (let k = 0; k < n; k++) {
      const slot = out[k]!;
      if (!food.alive[slot]) continue;
      const fx = food.x[slot]!;
      const fy = food.y[slot]!;
      const fr = food.radius[slot]!;
      const dx = s.x - fx;
      const dy = s.y - fy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= mr + fr) continue;
      const eatDist = s.radius + fr;
      let nd = d;
      if (d >= eatDist) {
        const pull = Math.min(d, (cfg.magnetSpeed + (mr - d) * 3) * DT);
        nd = d - pull;
        food.move(slot, fx + (dx / d) * pull, fy + (dy / d) * pull);
      }
      if (nd < eatDist) {
        s.score += food.value[slot]!;
        if (food.kind[slot] === FoodKind.Ambient) this.eatenAmbient.push(fx, fy);
        this.events.push({
          type: 'foodEaten',
          foodId: food.id[slot]!,
          // Çizimde yemin kaldığı yerden kafaya akması için tick başındaki konumu
          x: food.startX(slot),
          y: food.startY(slot),
          color: food.color[slot]!,
          radius: fr,
          kind: food.kind[slot] as FoodKind,
          eaterId: s.id,
        });
        food.remove(slot);
      }
    }
  }

  private rebuildGrid(): void {
    const grid = this.grid;
    grid.beginBuild();
    for (const s of this.snakeList) {
      grid.addSample(s.x, s.y, s.radius, 0, s.id);
      const b = s.body;
      const sp = b.spacing;
      const d0 = b.headGap(s.x, s.y);
      // Örnek aralığı yarıçapın yarısını geçmesin ki tüp boşluksuz kalsın
      const stride = Math.max(1, Math.floor((s.radius * 0.5) / sp));
      for (let i = 0; i < b.count; i += stride) {
        const arc = d0 + i * sp;
        if (arc > s.length) break;
        grid.addSample(b.x(i), b.y(i), s.radius, arc, s.id);
      }
    }
    grid.endBuild();
  }

  private detectCollisions(): Map<Snake, Death> {
    const cfg = this.cfg;
    const grid = this.grid;
    const R = cfg.arenaRadius;
    const deaths = new Map<Snake, Death>();
    const pairsDone = new Set<number>();

    for (const a of this.snakeList) {
      if (Math.sqrt(a.x * a.x + a.y * a.y) + a.radius >= R) {
        deaths.set(a, { reason: 'border', killerId: 0 });
        continue;
      }
      const hr = a.radius * cfg.headHitScale;
      const n = grid.query(a.x, a.y, hr + grid.maxRadius);
      const hits = grid.hits;
      let bodyKiller = 0;
      let headOpp = 0;
      for (let k = 0; k < n; k++) {
        const i = hits[k]!;
        const owner = grid.sOwner[i]!;
        if (owner === a.id) continue;
        const rr = hr + grid.sr[i]!;
        const dx = grid.sx[i]! - a.x;
        const dy = grid.sy[i]! - a.y;
        if (dx * dx + dy * dy >= rr * rr) continue;
        if (grid.sArc[i]! < cfg.headZoneK * grid.sr[i]!) {
          if (!headOpp) headOpp = owner;
        } else {
          bodyKiller = owner;
          break;
        }
      }
      if (bodyKiller) {
        if (!deaths.has(a)) deaths.set(a, { reason: 'body', killerId: bodyKiller });
        continue;
      }
      if (headOpp) {
        const b = this.snakes.get(headOpp);
        if (!b) continue;
        const key = a.id < b.id ? a.id * 1e6 + b.id : b.id * 1e6 + a.id;
        if (pairsDone.has(key)) continue;
        pairsDone.add(key);
        for (const loser of this.headToHeadLosers(a, b)) {
          const winner = loser === a ? b : a;
          if (!deaths.has(loser)) deaths.set(loser, { reason: 'head', killerId: winner.id });
        }
      }
    }
    return deaths;
  }

  /** Kafa-kafa: 1. sıradaki veya çok daha büyük olan yaşar, aksi halde ikisi de ölür. */
  private headToHeadLosers(a: Snake, b: Snake): Snake[] {
    const ratio = this.cfg.bigWinRatio;
    if (a.id === this.leaderId) return [b];
    if (b.id === this.leaderId) return [a];
    if (a.score >= b.score * ratio) return [b];
    if (b.score >= a.score * ratio) return [a];
    return [a, b];
  }

  private kill(s: Snake, reason: DeathReason, killerId: number): void {
    if (!s.alive) return;
    s.alive = false;
    this.snakes.delete(s.id);
    this.dropDeathFood(s);
    this.events.push({ type: 'died', id: s.id, reason, killerId, score: s.score, isBot: s.isBot });
  }

  /**
   * Ölen yılanın skorunun bir kısmını gövdesi boyunca sık dizilmiş, gövde kalınlığında
   * parlak yemler olarak bırakır: yemler üst üste binerek yılanın şeklini çizer.
   */
  private dropDeathFood(s: Snake): void {
    const cfg = this.cfg;
    const rng = this.rng;
    const total = s.score * cfg.deathDropRatio;
    if (total <= 0) return;
    const b = s.body;
    const pathLen = Math.min(s.length, b.headGap(s.x, s.y) + Math.max(0, b.count - 1) * b.spacing);
    const n = clamp(
      Math.floor(pathLen / (s.radius * cfg.deathOrbSpacing)) + 1,
      1,
      cfg.deathOrbMaxCount,
    );
    const value = total / n;
    const expire = this.tick + cfg.deathFoodLifeTicks;
    const jitter = s.radius * 0.3;
    const p = this.tmp;
    for (let i = 0; i < n; i++) {
      const arc = n === 1 ? 0 : (i / (n - 1)) * pathLen;
      b.pointAt(s.x, s.y, arc, p);
      this.addFoodClamped(
        p.x + rng.range(-jitter, jitter),
        p.y + rng.range(-jitter, jitter),
        value,
        s.color,
        FoodKind.Death,
        expire,
        s.radius * rng.range(cfg.deathOrbSizeMin, cfg.deathOrbSizeMax),
      );
    }
  }

  private maintainFood(): void {
    const food = this.food;
    if (this.tick % 15 === 0) {
      for (let slot = 0; slot < food.highWater; slot++) {
        if (food.alive[slot] && food.expire[slot]! >= 0 && food.expire[slot]! <= this.tick) {
          food.remove(slot);
        }
      }
    }
    // Yem hiç tükenmez: yenen her ortam yemi, yendiği bölgenin yakınında yeniden doğar
    const missing = Math.min(this.ambientTarget - food.ambientCount, this.cfg.ambientRefillPerTick);
    const near = this.eatenAmbient;
    for (let i = 0; i < missing; i++) {
      if (near.length >= 2) {
        const y = near.pop()!;
        this.spawnAmbientFood(near.pop()!, y);
      } else {
        this.spawnAmbientFood();
      }
    }
    near.length = 0;
  }

  /** (nearX, nearY) verilirse oraya `ambientRespawnMin..Max` uzaklıkta, yoksa arenada rastgele. */
  private spawnAmbientFood(nearX?: number, nearY?: number): void {
    const cfg = this.cfg;
    const rng = this.rng;
    const maxR = cfg.arenaRadius - 30;
    let x = 0;
    let y = 0;
    let placed = false;
    if (nearX !== undefined && nearY !== undefined) {
      const d = rng.range(cfg.ambientRespawnMin, cfg.ambientRespawnMax);
      const th = rng.next() * TAU;
      x = nearX + Math.cos(th) * d;
      y = nearY + Math.sin(th) * d;
      placed = x * x + y * y < maxR * maxR;
    }
    if (!placed) {
      const r = maxR * Math.sqrt(rng.next());
      const th = rng.next() * TAU;
      x = Math.cos(th) * r;
      y = Math.sin(th) * r;
    }
    this.food.add(
      x,
      y,
      rng.int(cfg.ambientValueMin, cfg.ambientValueMax + 1),
      rng.pick(AMBIENT_FOOD_COLORS),
      FoodKind.Ambient,
    );
  }

  private addFoodClamped(
    x: number,
    y: number,
    value: number,
    color: number,
    kind: FoodKind,
    expire: number,
    radius = foodRadius(value),
  ): void {
    const maxR = this.cfg.arenaRadius - 10 - radius;
    const d = Math.sqrt(x * x + y * y);
    if (d > maxR) {
      x = (x / d) * maxR;
      y = (y / d) * maxR;
    }
    this.food.add(x, y, value, color, kind, expire, radius);
  }
}
