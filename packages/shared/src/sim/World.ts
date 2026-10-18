import { AMBIENT_FOOD_COLORS } from '../colors';
import {
  DT,
  blackHoleArrivalTick,
  bodyTrimMargin,
  clampSpeedScale,
  foodRadius,
  lengthForScore,
  magnetRadius,
  makeConfig,
  radiusForScore,
  speedAtBoostLevel,
  turnRadiusFor,
  type SimConfig,
} from '../config';
import { TAU, angleDiff, clamp, normalizeAngle } from '../math';
import { Rng } from '../rng';
import { BodyGrid } from './BodyGrid';
import { FoodKind, FoodStore } from './FoodStore';
import { rankAmong, topScoreSum, topSnakes } from './ranking';
import { Snake } from './Snake';
import { findSpawnPoint } from './spawn';
import type { WorldView } from './WorldView';

/** Kafanın tick içindeki yolunu tararken bakılan en fazla nokta (5x boost'ta bile yeterli). */
const MAX_HEAD_PROBES = 16;

export type DeathReason = 'border' | 'body' | 'head' | 'left';

export type SimEvent =
  | { type: 'spawned'; id: number }
  /**
   * Yılan `blackHoleScore`a ulaştı: bu tick'ten (`tick`) önce doğmuş bütün yemleri çekip
   * yutmaya başlar (yutulan yemler `foodEaten` olarak da gelir).
   */
  | { type: 'blackHole'; id: number; tick: number }
  | {
      type: 'died';
      id: number;
      reason: DeathReason;
      /** Öldüren yılan; 0 = yok (sınır, ayrılma). */
      killerId: number;
      score: number;
      isBot: boolean;
      /** Ölenin adı ve renk indeksi (yılan artık dünyada yok; efektler ve bildirimler için). */
      name: string;
      color: number;
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

/** Süren kara delik: yutulacak yemler varış sırasıyla. */
interface BlackHole {
  snakeId: number;
  slots: Int32Array;
  ids: Uint32Array;
  arrive: Int32Array;
  next: number;
}

interface Death {
  reason: DeathReason;
  killerId: number;
}

/**
 * Oyun dünyası: kuralların tek kaynağı. Sunucu bunu yetkili olarak, istemci çevrimdışı modda
 * aynen çalıştırır. `step()` sabit DT ile bir tick ilerletir (CURRENT_PLAN.md §8).
 */
export class World implements WorldView {
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
  /**
   * Büyüklük sınırına ulaşıldı: ilk N yılanın toplam skoru `foodCapHigh`ı geçti ve henüz
   * `foodCapLow`a inmedi. Bu sürede ortam yemi yenilenmez, yemler söner.
   */
  foodCapped = false;

  private events: SimEvent[] = [];
  private blackHole: BlackHole | null = null;
  private nextSnakeId = 1;
  private trimMargin: number;
  private readonly scratch: number[] = [];
  private readonly tmp = { x: 0, y: 0 };
  /** Bu tick yenen ortam yemlerinin konumları (x, y çiftleri); yenileri bunların yakınında doğar. */
  private readonly eatenAmbient: number[] = [];

  constructor(cfg: Partial<SimConfig> = {}, seed = 1) {
    this.cfg = makeConfig(cfg);
    this.cfg.speedScale = clampSpeedScale(this.cfg.speedScale);
    this.rng = new Rng(seed);
    const R = this.cfg.arenaRadius;
    this.ambientTarget = Math.floor(Math.PI * R * R * this.cfg.foodDensity);
    this.food = new FoodStore(R, this.cfg.gridCellSize, Math.max(2048, this.ambientTarget * 1.5));
    this.grid = new BodyGrid(R, this.cfg.gridCellSize);
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
    s.blackHoleDone = s.score >= cfg.blackHoleScore;
    this.updateSize(s);
    let { x, y, angle } =
      opts.x !== undefined && opts.y !== undefined
        ? { x: opts.x, y: opts.y, angle: opts.angle ?? 0 }
        : findSpawnPoint(this);
    angle = normalizeAngle(angle);
    s.x = s.px = Math.fround(x);
    s.y = s.py = Math.fround(y);
    s.angle = s.pangle = s.targetAngle = angle;
    s.spawnTick = this.tick;
    s.body.reset(x, y, angle, s.length + this.trimMargin);
    this.snakes.set(s.id, s);
    this.snakeList.push(s);
    this.events.push({ type: 'spawned', id: s.id });
    return s;
  }

  /** Oyuncu ayrıldı: yılan ölmüş gibi yem bırakarak (veya `dropFood` false ise sessizce) kaldırılır. */
  removeSnake(id: number, dropFood = true): void {
    const s = this.snakes.get(id);
    if (!s) return;
    this.kill(s, 'left', 0, dropFood);
    this.snakeList = this.snakeList.filter((o) => o.alive);
  }

  /** Oyun hızı sürgüsü: yılan ve mıknatıs hızlarını çarpar (dönüş dairesi değişmez). */
  setSpeedScale(v: number): void {
    this.cfg.speedScale = clampSpeedScale(v);
    this.trimMargin = bodyTrimMargin(this.cfg);
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
    this.updateBlackHole();
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

  getLeaderboard(n: number): Snake[] {
    return topSnakes(this.snakeList, n);
  }

  rankOf(id: number): number {
    return rankAmong(this.snakeList, this.snakes.get(id));
  }

  /** Kara deliği başlatır (1M'a ulaşan ilk yılan) ya da sürenin yemlerini yutturur. */
  private updateBlackHole(): void {
    const cfg = this.cfg;
    if (!this.blackHole) {
      for (const s of this.snakeList) {
        if (s.blackHoleDone || s.score < cfg.blackHoleScore) continue;
        s.blackHoleDone = true;
        this.startBlackHole(s);
        break;
      }
    }
    const bh = this.blackHole;
    if (!bh) return;
    const s = this.snakes.get(bh.snakeId);
    if (!s) {
      this.blackHole = null; // yılan öldü: kalan yemler yerinde kalır
      return;
    }
    const food = this.food;
    let eaten = false;
    while (bh.next < bh.slots.length && bh.arrive[bh.next]! <= this.tick) {
      const i = bh.next++;
      const slot = bh.slots[i]!;
      if (!food.alive[slot] || food.id[slot] !== bh.ids[i]) continue; // bu arada başkası yedi
      s.score += food.value[slot]!;
      eaten = true;
      this.events.push({
        type: 'foodEaten',
        foodId: food.id[slot]!,
        x: food.x[slot]!,
        y: food.y[slot]!,
        color: food.color[slot]!,
        radius: food.radius[slot]!,
        kind: food.kind[slot] as FoodKind,
        eaterId: s.id,
      });
      // Yutulan ortam yemi yerinde yeniden doğmaz; harita boşalır, eksik zamanla tamamlanır
      food.remove(slot, s.id);
    }
    if (eaten) this.updateSize(s);
    if (bh.next >= bh.slots.length) this.blackHole = null;
  }

  private startBlackHole(s: Snake): void {
    const food = this.food;
    const t0 = this.tick;
    const slots: number[] = [];
    for (let slot = 0; slot < food.highWater; slot++) {
      // Bu tick doğan yem dahil değil (istemci de aynı kuralla seçer)
      if (food.alive[slot] && food.born[slot]! < t0) slots.push(slot);
    }
    const arrive = new Int32Array(slots.length);
    for (let i = 0; i < slots.length; i++) {
      const dx = food.x[slots[i]!]! - s.x;
      const dy = food.y[slots[i]!]! - s.y;
      arrive[i] = blackHoleArrivalTick(this.cfg, t0, Math.sqrt(dx * dx + dy * dy));
    }
    const order = slots.map((_, i) => i).sort((a, b) => arrive[a]! - arrive[b]!);
    const bh: BlackHole = {
      snakeId: s.id,
      slots: new Int32Array(order.length),
      ids: new Uint32Array(order.length),
      arrive: new Int32Array(order.length),
      next: 0,
    };
    for (let k = 0; k < order.length; k++) {
      const i = order[k]!;
      bh.slots[k] = slots[i]!;
      bh.ids[k] = food.id[slots[i]!]!;
      bh.arrive[k] = arrive[i]!;
    }
    this.blackHole = bh;
    this.events.push({ type: 'blackHole', id: s.id, tick: t0 });
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

    // Hız boost'a anında sıçramaz, `boostRamp*Seconds` içinde yumuşakça çıkar/iner
    const ramp = s.boosting ? DT / cfg.boostRampUpSeconds : -DT / cfg.boostRampDownSeconds;
    s.boostLevel = clamp(s.boostLevel + ramp, 0, 1);
    const speed = speedAtBoostLevel(cfg, s.radius, s.boostLevel);
    // Açısal hız = hız / dönüş yarıçapı: geçiş sırasında da aynı daireyi çizer
    const maxTurn = (speed / turnRadiusFor(cfg, s.radius)) * DT;
    s.angle = normalizeAngle(s.angle + clamp(angleDiff(s.angle, s.targetAngle), -maxTurn, maxTurn));
    const step = speed * DT;
    // Kafa konumu ağda float32 gider; burada da float32'ye yuvarlanır ki istemci aynı kafa
    // konumlarından birebir aynı gövdeyi kursun.
    s.x = Math.fround(s.x + Math.cos(s.angle) * step);
    s.y = Math.fround(s.y + Math.sin(s.angle) * step);

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
      this.dropExpire(),
    );
  }

  private eatFood(s: Snake): void {
    const cfg = this.cfg;
    const food = this.food;
    const mr = magnetRadius(cfg, s.radius, s.score);
    const out = this.scratch;
    const n = food.query(s.x, s.y, mr + food.maxRadius, out);
    const settledBorn = this.tick - cfg.deathFoodSettleTicks;
    for (let k = 0; k < n; k++) {
      const slot = out[k]!;
      if (!food.alive[slot]) continue;
      if (food.kind[slot] === FoodKind.Death && food.born[slot]! > settledBorn) continue;
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
        const pull = Math.min(d, (cfg.magnetSpeed * cfg.speedScale + (mr - d) * 3) * DT);
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
        food.remove(slot, s.id);
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
      // Hızlı oyunda (ör. 5x) kafa bir tick'te gövde kalınlığından fazla yol alır: yalnızca
      // varış noktasına bakmak gövdenin içinden geçip gitmesine izin verirdi. Bu yüzden kafanın
      // bu tick'te izlediği yol, aralığı kafa yarıçapını geçmeyen noktalarla taranır.
      const mx = a.x - a.px;
      const my = a.y - a.py;
      const travel = Math.sqrt(mx * mx + my * my);
      const probes = Math.min(MAX_HEAD_PROBES, Math.max(1, Math.ceil(travel / Math.max(4, hr))));
      let bodyKiller = 0;
      let headOpp = 0;
      for (let p = 1; p <= probes && !bodyKiller && !headOpp; p++) {
        const t = p / probes;
        const hx = a.px + mx * t;
        const hy = a.py + my * t;
        const n = grid.query(hx, hy, hr + grid.maxRadius);
        const hits = grid.hits;
        for (let k = 0; k < n; k++) {
          const i = hits[k]!;
          const owner = grid.sOwner[i]!;
          if (owner === a.id) continue;
          const rr = hr + grid.sr[i]!;
          const dx = grid.sx[i]! - hx;
          const dy = grid.sy[i]! - hy;
          if (dx * dx + dy * dy >= rr * rr) continue;
          if (grid.sArc[i]! < cfg.headZoneK * grid.sr[i]!) {
            if (!headOpp) headOpp = owner;
          } else {
            bodyKiller = owner;
            break;
          }
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

  private kill(s: Snake, reason: DeathReason, killerId: number, dropFood = true): void {
    if (!s.alive) return;
    s.alive = false;
    this.snakes.delete(s.id);
    if (dropFood) this.dropDeathFood(s);
    this.events.push({
      type: 'died',
      id: s.id,
      reason,
      killerId,
      score: s.score,
      isBot: s.isBot,
      name: s.name,
      color: s.color,
    });
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
        this.dropExpire(),
        s.radius * rng.range(cfg.deathOrbSizeMin, cfg.deathOrbSizeMax),
      );
    }
  }

  /** Boost/ölüm yeminin söneceği tick: normalde hiç (-1); büyüklük sınırındayken bir süre sonra. */
  private dropExpire(): number {
    return this.foodCapped ? this.capFadeTick() : -1;
  }

  private capFadeTick(): number {
    const cfg = this.cfg;
    return this.tick + this.rng.int(cfg.foodCapFadeMinTicks, cfg.foodCapFadeMaxTicks + 1);
  }

  private maintainFood(): void {
    const food = this.food;
    const cfg = this.cfg;
    if (this.tick % 15 === 0) {
      this.updateFoodCap();
      this.limitLooseFood();
      for (let slot = 0; slot < food.highWater; slot++) {
        if (!food.alive[slot]) continue;
        const expire = food.expire[slot]!;
        if (expire >= 0 && expire <= this.tick) food.remove(slot);
      }
    }
    const near = this.eatenAmbient;
    if (!this.foodCapped) {
      // Yem hiç tükenmez: yenen her ortam yemi, yendiği bölgenin yakınında yeniden doğar.
      // Ortam yemi sayısı hedefte sabit kalır (ortam yemi kapalı dünyada hiç doğmaz).
      let budget = this.ambientTarget > 0 ? cfg.ambientRefillPerTick : 0;
      while (near.length >= 2 && budget > 0) {
        const y = near.pop()!;
        this.spawnAmbientFood(near.pop()!, y);
        budget--;
      }
      // Hedefin altındaysa (ör. büyüklük sınırından çıkınca) rastgele yerlerde tamamlanır
      const missing = Math.min(this.ambientTarget - food.ambientCount, budget);
      for (let i = 0; i < missing; i++) this.spawnAmbientFood();
    }
    near.length = 0;
  }

  /**
   * Büyüklük döngüsü: ilk N yılanın toplamı üst eşiğe ulaşınca yemler sönmeye başlar ve
   * ortam yemi yenilenmez; toplam alt eşiğe inince sönmekte olan yemler kalıcı olur.
   */
  private updateFoodCap(): void {
    const cfg = this.cfg;
    const food = this.food;
    const total = topScoreSum(this.snakeList, cfg.foodCapTopN);
    if (!this.foodCapped && total >= cfg.foodCapHigh) {
      this.foodCapped = true;
      for (let slot = 0; slot < food.highWater; slot++) {
        if (food.alive[slot] && food.expire[slot]! < 0) food.setExpire(slot, this.capFadeTick());
      }
    } else if (this.foodCapped && total <= cfg.foodCapLow) {
      this.foodCapped = false;
      for (let slot = 0; slot < food.highWater; slot++) {
        if (food.alive[slot] && food.expire[slot]! >= 0) food.setExpire(slot, -1);
      }
    }
  }

  /** Güvenlik sınırı: ortam dışı yem `looseFoodMax`ı aşarsa fazlası (en eskiler) söner. */
  private limitLooseFood(): void {
    const food = this.food;
    if (food.looseCount <= this.cfg.looseFoodMax) return;
    const keep: number[] = [];
    for (let slot = 0; slot < food.highWater; slot++) {
      if (food.alive[slot] && food.kind[slot] !== FoodKind.Ambient && food.expire[slot]! < 0) {
        keep.push(slot);
      }
    }
    const excess = keep.length - this.cfg.looseFoodMax;
    if (excess <= 0) return;
    keep.sort((a, b) => food.born[a]! - food.born[b]!);
    for (let i = 0; i < excess; i++) food.setExpire(keep[i]!, this.capFadeTick());
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
    const base = rng.int(cfg.ambientValueMin, cfg.ambientValueMax + 1);
    this.food.add(
      x,
      y,
      base * cfg.ambientGrowth,
      rng.pick(AMBIENT_FOOD_COLORS),
      FoodKind.Ambient,
      -1,
      foodRadius(base),
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
