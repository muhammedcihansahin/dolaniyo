import {
  TAU,
  blackHoleArrivalTick,
  clamp,
  easeOutCubic,
  lerp,
  type WorldView,
} from '@yilan/shared';
import { Container, Graphics, Sprite } from 'pixi.js';
import { TEX_RADIUS, type GameTextures } from './textures';

/** Girdabın belirme ve son yem yutulduktan sonra sönme süreleri (sn). */
const GROW_SECONDS = 0.45;
const FADE_SECONDS = 1.2;
/** Son yem yutulunca çıkan şok dalgasının süresi. */
const SHOCK_SECONDS = 0.9;
/** Yem kafaya varana dek kafanın çevresinde döndüğü toplam açı (rad). */
const SWIRL = 2.6;
/** Bir karede en fazla çizilen çekilen yem. */
const MAX_DRAWN = 9000;

const DISK_COLORS = [0xb26bff, 0xff9a4d, 0x6be4ff, 0xff5ec4];

export interface HoleRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 1M kara deliği: yılan 1 milyona ulaştığı an haritadaki bütün yem (o tick'ten önce doğmuş)
 * sarmal çizerek kafasına akar. Hangi yemin ne zaman yutulacağı simülasyonla aynı formülden
 * (`blackHoleArrivalTick`) hesaplanır; sunucu yemi o tick'te siler, burada da tam o ana kadar
 * kafaya doğru çizilir. Kafada kara bir girdap, dönen ışık diski ve sonda şok dalgası görünür.
 */
export class BlackHoleFx {
  /** Girdap (yılanların altında, yemlerin üstünde). */
  readonly layer = new Container();
  private readonly glow: Sprite;
  private readonly disk = new Graphics();
  private readonly core: Sprite;
  private readonly shock: Sprite;

  private snakeId = 0;
  private t0 = 0;
  private slots = new Int32Array(0);
  private ids = new Uint32Array(0);
  private arrive = new Int32Array(0);
  private dist = new Float32Array(0);
  /** slot → snapshot sırası + 1 (0 = çekilmiyor). */
  private mark = new Int32Array(0);
  /** Yem çekiliyor (yılan yaşıyor ve yutulacak yem kaldı). */
  private pulling = false;
  private age = Infinity;
  /** Son yemin yutulmasından (ya da yılanın ölümünden) beri geçen süre; çekerken -1. */
  private fadeT = -1;
  private hx = 0;
  private hy = 0;
  private radius = 0;

  constructor(textures: GameTextures) {
    const add = new Container({ blendMode: 'add' });
    this.glow = new Sprite(textures.glow);
    this.glow.anchor.set(0.5);
    this.glow.tint = 0x7a3cff;
    this.shock = new Sprite(textures.ring);
    this.shock.anchor.set(0.5);
    this.shock.tint = 0xd9b8ff;
    add.addChild(this.glow, this.disk, this.shock);
    this.core = new Sprite(textures.blob);
    this.core.anchor.set(0.5);
    this.core.tint = 0x000000;
    this.layer.addChild(add, this.core);
    this.layer.visible = false;
  }

  /** Girdap ya da çekilen yem ekranda. */
  get active(): boolean {
    return this.layer.visible;
  }

  /** `eaterId`nin yuttuğu yemler kafaya akış efektiyle değil, girdapla çizilir. */
  swallowing(eaterId: number): boolean {
    return this.pulling && eaterId === this.snakeId;
  }

  /** Bu yem kara deliğe akıyor mu (normal yem çiziminde atlanır). */
  isPulled(slot: number, id: number): boolean {
    if (!this.pulling || slot >= this.mark.length) return false;
    const i = this.mark[slot]!;
    return i > 0 && this.ids[i - 1] === id;
  }

  start(world: WorldView, snakeId: number, t0: number): void {
    const s = world.snakes.get(snakeId);
    if (!s) return;
    const food = world.food;
    const cfg = world.cfg;
    const picked: number[] = [];
    for (let slot = 0; slot < food.highWater; slot++) {
      if (food.alive[slot] && food.born[slot]! < t0) picked.push(slot);
    }
    const n = picked.length;
    this.slots = Int32Array.from(picked);
    this.ids = new Uint32Array(n);
    this.arrive = new Int32Array(n);
    this.dist = new Float32Array(n);
    this.mark = new Int32Array(food.highWater);
    for (let i = 0; i < n; i++) {
      const slot = picked[i]!;
      const dx = food.x[slot]! - s.x;
      const dy = food.y[slot]! - s.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      this.ids[i] = food.id[slot]!;
      this.dist[i] = d;
      this.arrive[i] = blackHoleArrivalTick(cfg, t0, d);
      this.mark[slot] = i + 1;
    }
    this.snakeId = snakeId;
    this.t0 = t0;
    this.pulling = true;
    this.age = 0;
    this.fadeT = -1;
    this.hx = s.x;
    this.hy = s.y;
    this.radius = s.radius;
    this.layer.visible = true;
  }

  clear(): void {
    this.pulling = false;
    this.layer.visible = false;
    this.mark = new Int32Array(0);
  }

  /**
   * Kafaya akan yemleri çizer: (x, y, yarıçap) ekran dikdörtgeninde olanlar için `draw` çağrılır.
   * Yem kafaya yaklaştıkça hızlanır, döner ve küçülür.
   */
  drawFood(
    world: WorldView,
    alpha: number,
    rect: HoleRect,
    draw: (slot: number, x: number, y: number, r: number) => void,
  ): void {
    if (!this.pulling) return;
    const food = world.food;
    const tickF = world.tick + alpha;
    const { hx, hy } = this;
    const cx = (rect.minX + rect.maxX) / 2;
    const cy = (rect.minY + rect.maxY) / 2;
    // Kafadan bu uzaklığın ötesindeki yem ekrana giremez
    const reach =
      Math.hypot(cx - hx, cy - hy) + Math.hypot(rect.maxX - cx, rect.maxY - cy) + food.maxRadius;
    let drawn = 0;
    for (let i = 0; i < this.slots.length && drawn < MAX_DRAWN; i++) {
      const slot = this.slots[i]!;
      if (!food.alive[slot] || food.id[slot] !== this.ids[i]) continue;
      const span = this.arrive[i]! - this.t0;
      const p = clamp((tickF - this.t0) / span, 0, 1);
      const e = p * p;
      const k = 1 - e;
      if (this.dist[i]! * k > reach + 600) continue;
      const vx = food.x[slot]! - hx;
      const vy = food.y[slot]! - hy;
      const a = SWIRL * e;
      const c = Math.cos(a) * k;
      const sn = Math.sin(a) * k;
      const x = hx + vx * c - vy * sn;
      const y = hy + vx * sn + vy * c;
      const r = food.radius[slot]! * (1 - 0.5 * e);
      if (x + r < rect.minX || x - r > rect.maxX || y + r < rect.minY || y - r > rect.maxY) {
        continue;
      }
      draw(slot, x, y, r);
      drawn++;
    }
  }

  /** Girdabı yılanın kafasına yerleştirir ve canlandırır. */
  update(world: WorldView, alpha: number, dt: number): void {
    if (!this.layer.visible) return;
    this.age += dt;
    const s = world.snakes.get(this.snakeId);
    if (s) {
      this.hx = lerp(s.px, s.x, alpha);
      this.hy = lerp(s.py, s.y, alpha);
      this.radius = s.radius;
    }
    const done = !s || world.tick >= this.t0 + world.cfg.blackHoleTicks;
    if (this.pulling && done) {
      // Yılan öldüyse kalan yemler yerinde kalır (normal çizime döner)
      this.pulling = false;
      this.fadeT = 0;
    }
    if (this.fadeT >= 0) this.fadeT += dt;
    const fade = this.fadeT < 0 ? 1 : 1 - this.fadeT / FADE_SECONDS;
    if (fade <= 0 && this.fadeT > SHOCK_SECONDS) {
      this.layer.visible = false;
      return;
    }
    const env = easeOutCubic(clamp(this.age / GROW_SECONDS, 0, 1)) * clamp(fade, 0, 1);
    const R = this.radius * 2.3 * env;
    const { hx, hy } = this;
    const throb = 1 + 0.05 * Math.sin(this.age * 9);

    this.core.position.set(hx, hy);
    this.core.scale.set((R * 1.05 * throb) / TEX_RADIUS);
    this.core.alpha = 0.92 * env;

    this.glow.position.set(hx, hy);
    this.glow.scale.set((R * 5.5) / TEX_RADIUS);
    this.glow.alpha = 0.55 * env;

    // Dönen ışık diski: farklı yarıçap ve hızlarda kısmi yaylar
    const g = this.disk.clear();
    if (R > 1) {
      for (let k = 0; k < 7; k++) {
        const rr = R * (1.08 + 0.17 * k) * throb;
        const spin = this.age * (3.4 - 0.32 * k) + k * 1.7;
        const sweep = 1.3 + 0.5 * Math.sin(this.age * 2 + k);
        for (let half = 0; half < 2; half++) {
          const a0 = spin + half * Math.PI;
          g.moveTo(hx + Math.cos(a0) * rr, hy + Math.sin(a0) * rr)
            .arc(hx, hy, rr, a0, a0 + sweep)
            .stroke({
              width: R * (0.16 - 0.012 * k),
              color: DISK_COLORS[k % DISK_COLORS.length]!,
              alpha: (0.75 - 0.07 * k) * env,
              cap: 'round',
            });
        }
      }
    }

    // Son yem yutulunca dışa doğru bir şok dalgası
    const st = this.fadeT < 0 ? -1 : this.fadeT / SHOCK_SECONDS;
    this.shock.visible = st >= 0 && st < 1 && s !== undefined;
    if (this.shock.visible) {
      const e = easeOutCubic(st);
      this.shock.position.set(hx, hy);
      this.shock.scale.set((this.radius * (3 + 22 * e)) / TEX_RADIUS);
      this.shock.alpha = 0.9 * (1 - st);
      this.shock.rotation = (this.age * 0.5) % TAU;
    }
  }
}
