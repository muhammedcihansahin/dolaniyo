import { bodyTrimMargin, lengthForScore, radiusForScore, type SimConfig } from '../config';
import { FoodStore, type FoodKind } from '../sim/FoodStore';
import { rankAmong, topSnakes } from '../sim/ranking';
import { Snake } from '../sim/Snake';
import type { SimEvent } from '../sim/World';
import type { WorldView } from '../sim/WorldView';
import { BinaryReader } from './binary';
import { BinMsg, DEATH_REASONS, unpackAngle } from './protocol';

/**
 * İstemci tarafı: sunucudaki odanın aynası. `WorldEncoder`ın ürettiği INIT/TICK mesajlarını
 * uygular; çizim ve arayüz bunu çevrimdışı `World` ile aynı şekilde okur (`WorldView`).
 * Gövdeler sunucudakiyle aynı algoritmayla, aynı float32 kafa konumlarından kurulur.
 */
export class WorldMirror implements WorldView {
  readonly food: FoodStore;
  readonly snakes = new Map<number, Snake>();
  snakeList: Snake[] = [];
  tick = 0;

  /** Sunucunun yem id'si → buradaki slot. */
  private readonly slotOf = new Map<number, number>();
  private trimMargin: number;

  constructor(readonly cfg: SimConfig) {
    this.food = new FoodStore(cfg.arenaRadius, cfg.gridCellSize, 4096);
    this.trimMargin = bodyTrimMargin(cfg);
  }

  /** Odanın oyun hızı değişti: gövde kırpma payı sunucununkiyle aynı kalsın. */
  setSpeedScale(v: number): void {
    this.cfg.speedScale = v;
    this.trimMargin = bodyTrimMargin(this.cfg);
  }

  getLeaderboard(n: number): Snake[] {
    return topSnakes(this.snakeList, n);
  }

  rankOf(id: number): number {
    return rankAmong(this.snakeList, this.snakes.get(id));
  }

  /** INIT veya TICK mesajını uygular; TICK'ten doğan olayları (yem yendi, yılan öldü) döner. */
  apply(data: ArrayBuffer | Uint8Array): SimEvent[] {
    const r = new BinaryReader(data);
    const type = r.u8();
    if (type === BinMsg.Init) {
      this.applyInit(r);
      return [];
    }
    if (type === BinMsg.Tick) return this.applyTick(r);
    return [];
  }

  private applyInit(r: BinaryReader): void {
    this.snakes.clear();
    this.snakeList = [];
    for (const slot of this.slotOf.values()) this.food.remove(slot);
    this.slotOf.clear();
    this.setTick(r.u32());
    const snakes = r.u16();
    for (let i = 0; i < snakes; i++) this.readSnakeFull(r);
    const foods = r.u32();
    for (let i = 0; i < foods; i++) this.readFoodAdd(r);
  }

  private applyTick(r: BinaryReader): SimEvent[] {
    const events: SimEvent[] = [];
    this.setTick(r.u32());

    const fresh = r.u16();
    for (let i = 0; i < fresh; i++) this.readSnakeFull(r);

    const updates = r.u16();
    for (let i = 0; i < updates; i++) {
      const s = this.snakes.get(r.u32());
      const x = r.f32();
      const y = r.f32();
      const angle = unpackAngle(r.u16());
      const target = unpackAngle(r.u16());
      const score = r.f32();
      const flags = r.u8();
      if (!s) continue;
      s.px = s.x;
      s.py = s.y;
      s.pangle = s.angle;
      s.x = x;
      s.y = y;
      s.angle = angle;
      s.targetAngle = target;
      s.boosting = (flags & 1) !== 0;
      this.setScore(s, score);
      s.body.advance(x, y);
      // Sunucu kırpmayı yemeden önceki skorla yapar; burada en az onun kadar nokta kalır
      s.body.trim(x, y, s.length + this.trimMargin);
    }

    const deaths: SimEvent[] = [];
    const deathCount = r.u32();
    for (let i = 0; i < deathCount; i++) {
      const id = r.u32();
      const reason = DEATH_REASONS[r.u8()] ?? 'body';
      const killerId = r.u32();
      const score = r.f32();
      const s = this.snakes.get(id);
      if (!s) continue;
      deaths.push({
        type: 'died',
        id,
        reason,
        killerId,
        score,
        isBot: s.isBot,
        name: s.name,
        color: s.color,
      });
    }

    const adds = r.u32();
    for (let i = 0; i < adds; i++) this.readFoodAdd(r);

    const food = this.food;
    const moves = r.u32();
    for (let i = 0; i < moves; i++) {
      const slot = this.slotOf.get(r.u32());
      const x = r.f32();
      const y = r.f32();
      if (slot !== undefined) food.move(slot, x, y);
    }

    const expires = r.u32();
    for (let i = 0; i < expires; i++) {
      const slot = this.slotOf.get(r.u32());
      const expire = r.i32();
      if (slot !== undefined) food.setExpire(slot, expire);
    }

    const removes = r.u32();
    for (let i = 0; i < removes; i++) {
      const id = r.u32();
      const eaterId = r.u32();
      const slot = this.slotOf.get(id);
      if (slot === undefined) continue;
      if (eaterId) {
        events.push({
          type: 'foodEaten',
          foodId: id,
          x: food.startX(slot),
          y: food.startY(slot),
          color: food.color[slot]!,
          radius: food.radius[slot]!,
          kind: food.kind[slot] as FoodKind,
          eaterId,
        });
      }
      food.remove(slot);
      this.slotOf.delete(id);
    }

    const holes = r.u32();
    for (let i = 0; i < holes; i++)
      events.push({ type: 'blackHole', id: r.u32(), tick: this.tick });

    // Ölenler en son çıkarılır: aynı tick'te yedikleri yemin olayı yiyeni bulabilsin
    if (deaths.length > 0) {
      for (const e of deaths) if (e.type === 'died') this.snakes.delete(e.id);
      this.snakeList = this.snakeList.filter((s) => this.snakes.has(s.id));
      events.push(...deaths);
    }
    return events;
  }

  private setTick(tick: number): void {
    this.tick = tick;
    this.food.tick = tick;
  }

  private setScore(s: Snake, score: number): void {
    s.score = score;
    s.radius = radiusForScore(this.cfg, score);
    s.length = lengthForScore(this.cfg, score);
  }

  private readSnakeFull(r: BinaryReader): void {
    const id = r.u32();
    const spawnTick = r.u32();
    const color = r.u8();
    const flags = r.u8();
    const name = r.str();
    const s = new Snake(id, name, color, (flags & 2) !== 0, this.cfg.segmentSpacing);
    s.spawnTick = spawnTick;
    s.boosting = (flags & 1) !== 0;
    s.x = s.px = r.f32();
    s.y = s.py = r.f32();
    s.angle = s.pangle = unpackAngle(r.u16());
    s.targetAngle = unpackAngle(r.u16());
    this.setScore(s, r.f32());
    const n = r.u32();
    const pts = new Float32Array(n * 2);
    for (let i = 0; i < n * 2; i++) pts[i] = r.f32();
    // Gövde kuyruktan kafaya doğru eklenir (en yeni nokta = kafaya en yakın)
    for (let i = n - 1; i >= 0; i--) s.body.push(pts[i * 2]!, pts[i * 2 + 1]!);

    if (this.snakes.has(id)) {
      this.snakeList = this.snakeList.map((o) => (o.id === id ? s : o));
    } else {
      this.snakeList.push(s);
    }
    this.snakes.set(id, s);
  }

  private readFoodAdd(r: BinaryReader): void {
    const id = r.u32();
    const x = r.f32();
    const y = r.f32();
    const radius = r.f32();
    const color = r.u8();
    const kind = r.u8() as FoodKind;
    const expire = r.i32();
    const food = this.food;
    const old = this.slotOf.get(id);
    // INIT ile ilk TICK arasında aynı yem iki kez gelebilir
    if (old !== undefined) food.remove(old);
    this.slotOf.set(id, food.add(x, y, 0, color, kind, expire, radius, id));
  }
}
