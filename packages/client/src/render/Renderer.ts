import {
  DT,
  FoodKind,
  PALETTE,
  clamp,
  easeOutCubic,
  lerp,
  type SimEvent,
  type SnakeLike,
  type WorldView,
} from '@yilan/shared';
import { Application, Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { t as tr } from '../i18n';
import { BlackHoleFx } from './BlackHoleFx';
import { DeathFx, KillBanner } from './DeathFx';
import { SnakeView, type ViewRect } from './SnakeView';
import { SpritePool } from './SpritePool';
import { createTextures, type GameTextures } from './textures';

const SPAWN_ZOOM_SECONDS = 0.9;
const BORDER_COLOR = 0x6fb6ff;
/** Yeni yemin büyüyerek belirme süresi. */
const FOOD_POP_SECONDS = 0.35;
/** Süresi dolan yemin küçülüp sönme süresi. */
const FOOD_FADE_SECONDS = 1.5;
/** Yenen yemin kafaya akıp kaybolma süresi. */
const EAT_SECONDS = 0.16;
const MAX_EAT_FX = 600;
/** Ölen (veya görüşten çıkan) yılanın solma süresi. */
const SNAKE_FADE_SECONDS = 0.3;
/** Ekran sarsıntısı: en büyük kayma (900 px'lik ekranda) ve saniyedeki sönüm. */
const SHAKE_MAX_PX = 16;
const SHAKE_DECAY = 1.7;
/** Ekran kenarı flaşının (ölüm kırmızı, öldürme altın) sönme süresi. */
const VIGNETTE_SECONDS = 0.7;

/** Yenen bir yemin kafaya doğru akan görüntüsü. */
interface EatFx {
  x: number;
  y: number;
  radius: number;
  color: number;
  death: boolean;
  eaterId: number;
  /** Yiyenin son bilinen kafa konumu (yılan bu arada ölürse oraya akar). */
  hx: number;
  hy: number;
  t: number;
}

export interface FocusOptions {
  /** Kamera bu yılanı izler; null ise yerinde kalır. */
  snake: SnakeLike | null;
  /** true: oyuncunun kendi yılanı (kafa tam ortada); false: izleyici modu (yumuşak takip). */
  own: boolean;
}

export class Renderer {
  readonly cam = { x: 0, y: 0, zoom: 0.5 };

  private readonly textures: GameTextures;
  private readonly bg: TilingSprite;
  private readonly worldLayer = new Container();
  private readonly snakeLayer = new Container({ sortableChildren: true });
  private readonly foodGlow: SpritePool;
  private readonly deathBlob: SpritePool;
  private readonly deathCore: SpritePool;
  private readonly foodCore: SpritePool;
  private readonly deathFx: DeathFx;
  private readonly hole: BlackHoleFx;
  private readonly killBanner = new KillBanner();
  private readonly vignette: Sprite;
  private vignetteT = VIGNETTE_SECONDS;
  private vignettePeak = 0;
  /** Sarsıntı "travması" (0..1); kayma bunun karesiyle orantılı, zamanla söner. */
  private trauma = 0;
  private readonly views = new Map<number, SnakeView>();
  /** Görüşten çıkmış, solarak kaybolan yılan çizimleri (kalan süre, sn). */
  private readonly fading = new Map<SnakeView, number>();
  private readonly foodScratch: number[] = [];
  private readonly viewRect: ViewRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private readonly seen = new Set<number>();
  private eatFx: EatFx[] = [];
  /**
   * Ölüm yemleri yılan renginde değil, beyaza çok yakın açık tonda çizilir (içinde hafif renk
   * kalır); dış halesi biraz daha renkli.
   */
  private readonly deathBodyPalette = PALETTE.map((c) => mixColor(c, 0xffffff, 0.74));
  private readonly deathHaloPalette = PALETTE.map((c) => mixColor(c, 0xffffff, 0.4));
  private time = 0;
  private spawnZoomT = SPAWN_ZOOM_SECONDS;

  private readonly outside = new Graphics();
  private readonly border = new Graphics();
  private arenaRadius = 0;

  constructor(
    private readonly app: Application,
    private world: WorldView,
  ) {
    this.textures = createTextures();
    this.bg = new TilingSprite({ texture: this.textures.hexTile, width: 1, height: 1 });
    app.stage.addChild(this.bg, this.worldLayer);
    const { outside, border } = this;
    this.drawArena(world.cfg.arenaRadius);

    const foodGlowLayer = new Container({ blendMode: 'add' });
    const deathLayer = new Container();
    const foodLayer = new Container();
    this.foodGlow = new SpritePool(foodGlowLayer, this.textures.glow);
    this.deathBlob = new SpritePool(deathLayer, this.textures.blob);
    this.deathCore = new SpritePool(deathLayer, this.textures.blob);
    this.foodCore = new SpritePool(foodLayer, this.textures.circle);
    this.deathFx = new DeathFx(this.textures);
    this.hole = new BlackHoleFx(this.textures);
    this.worldLayer.addChild(
      outside,
      foodGlowLayer,
      deathLayer,
      foodLayer,
      this.hole.layer,
      this.snakeLayer,
      this.deathFx.layer,
      border,
    );
    this.vignette = new Sprite(this.textures.vignette);
    this.vignette.visible = false;
    app.stage.addChild(this.vignette, this.killBanner.root);
  }

  /** Başka bir dünyaya geçer (çevrimdışı ↔ oda): eski yılan çizimleri ve efektler atılır. */
  setWorld(world: WorldView): void {
    if (world === this.world) return;
    this.world = world;
    for (const view of this.views.values()) view.destroy();
    for (const view of this.fading.keys()) view.destroy();
    this.views.clear();
    this.fading.clear();
    this.eatFx = [];
    this.deathFx.clear();
    this.hole.clear();
    this.trauma = 0;
    this.drawArena(world.cfg.arenaRadius);
  }

  private drawArena(R: number): void {
    if (R === this.arenaRadius) return;
    this.arenaRadius = R;
    this.outside
      .clear()
      .rect(-R * 4, -R * 4, R * 8, R * 8)
      .fill({ color: 0x000000, alpha: 0.55 })
      .circle(0, 0, R + 20)
      .cut();
    this.border
      .clear()
      .circle(0, 0, R + 20)
      .stroke({ width: 140, color: BORDER_COLOR, alpha: 0.1 })
      .circle(0, 0, R + 20)
      .stroke({ width: 40, color: BORDER_COLOR, alpha: 0.9 });
  }

  /** Oyuncu doğduğunda: uzaktan yakınlaşma animasyonu başlar, öldürme serisi sıfırlanır. */
  startSpawnZoom(): void {
    this.spawnZoomT = 0;
    this.killBanner.reset();
  }

  /**
   * Simülasyon olaylarından görsel efektler üretir (her tick'ten sonra çağrılır).
   * `playerId`: tick'ten önceki oyuncu yılanı (bu tick'te ölmüş olabilir); yoksa 0.
   */
  onEvents(events: readonly SimEvent[], playerId = 0): void {
    for (const e of events) {
      if (e.type === 'died') {
        if (e.reason !== 'left') this.onDeath(e, playerId);
        continue;
      }
      if (e.type === 'blackHole') {
        this.onBlackHole(e.id, e.tick, playerId);
        continue;
      }
      if (e.type !== 'foodEaten') continue;
      // Kara deliğin yuttuğu yemler girdapla çizilir
      if (this.hole.swallowing(e.eaterId)) continue;
      const eater = this.world.snakes.get(e.eaterId);
      this.eatFx.push({
        x: e.x,
        y: e.y,
        radius: e.radius,
        color: e.color,
        death: e.kind === FoodKind.Death,
        eaterId: e.eaterId,
        hx: eater?.x ?? e.x,
        hy: eater?.y ?? e.y,
        t: 0,
      });
    }
    if (this.eatFx.length > MAX_EAT_FX) this.eatFx.splice(0, this.eatFx.length - MAX_EAT_FX);
  }

  /**
   * Ölüm efekti: yılan ekrandaysa gövdesinde zincirleme patlama. Oyuncunun kendi ölümü ve
   * oyuncunun öldürdüğü yılanlar daha güçlü patlar, ekranı sarsar ve kenarda flaş yapar;
   * öldürmede üstte "ELENDİ!" yazısı çıkar.
   */
  private onDeath(e: Extract<SimEvent, { type: 'died' }>, playerId: number): void {
    const own = playerId !== 0 && e.id === playerId;
    const byMe = playerId !== 0 && e.killerId === playerId && !own;
    const view = this.views.get(e.id);
    const ts = view?.tubeSamples;
    if (view && ts && view.radius > 0 && ts.n > 0) {
      const power = own ? 1.6 : byMe ? 1.45 : 1;
      this.deathFx.burst(ts.xs, ts.ys, ts.arcs, ts.n, view.radius, view.colorIdx, power);
    }
    if (own) {
      this.addShake(0.9);
      this.flashVignette(0xff3048, 0.85);
    } else if (byMe) {
      this.addShake(0.5);
      this.flashVignette(0xffd23f, 0.4);
      this.killBanner.show(e.name, e.color);
    } else if (view && ts && view.radius > 0 && ts.n > 0) {
      // Yakında ölen yılan (büyüdükçe daha çok) ekranı hafifçe sallar
      const w = this.app.screen.width / 2 / this.cam.zoom;
      const h = this.app.screen.height / 2 / this.cam.zoom;
      const dx = ts.xs[0]! - this.cam.x;
      const dy = ts.ys[0]! - this.cam.y;
      const near = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) / Math.sqrt(w * w + h * h));
      this.addShake(0.16 * clamp(view.radius / 18, 0.6, 2.2) * near);
    }
  }

  /** 1M: kara delik açıldı. Herkes duyuruyu görür; yakındakiler sarsılır. */
  private onBlackHole(id: number, tick: number, playerId: number): void {
    const s = this.world.snakes.get(id);
    if (!s) return;
    this.hole.start(this.world, id, tick);
    const own = playerId !== 0 && id === playerId;
    this.killBanner.announce(
      tr('fx.blackHole'),
      own ? tr('fx.blackHoleYou') : tr('fx.blackHoleBy', { name: s.name }),
      0xc58bff,
      3.2,
    );
    this.flashVignette(0x9b4dff, own ? 0.9 : 0.55);
    const w = this.app.screen.width / 2 / this.cam.zoom;
    const h = this.app.screen.height / 2 / this.cam.zoom;
    const near =
      1 - Math.min(1, Math.hypot(s.x - this.cam.x, s.y - this.cam.y) / (3 * Math.hypot(w, h)));
    this.addShake(own ? 1 : 0.2 + 0.6 * near);
  }

  private addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  private flashVignette(color: number, peak: number): void {
    this.vignette.tint = color;
    this.vignettePeak = peak;
    this.vignetteT = 0;
  }

  /** Ekran kenarı flaşı ve öldürme yazısı (dünya katmanının üstünde, ekran koordinatında). */
  private renderOverlay(dt: number, w: number, h: number): void {
    this.vignetteT += dt;
    const p = this.vignetteT / VIGNETTE_SECONDS;
    this.vignette.visible = p < 1;
    if (p < 1) {
      this.vignette.width = w;
      this.vignette.height = h;
      this.vignette.alpha = this.vignettePeak * (1 - p) * (1 - p);
    }
    this.killBanner.update(dt, w, h);
  }

  render(alpha: number, dt: number, focus: FocusOptions, showNames: boolean): void {
    this.time += dt;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const base = Math.min(w, h) / 900;
    this.updateCamera(alpha, dt, focus, base);

    const { x: cx, y: cy, zoom } = this.cam;
    // Sarsıntı yalnızca çizimi kaydırır (kamera konumu ve oyun mantığı etkilenmez)
    this.trauma = Math.max(0, this.trauma - dt * SHAKE_DECAY);
    const shake = this.trauma * this.trauma * SHAKE_MAX_PX * base;
    const t = this.time;
    const sx = shake * (Math.sin(t * 47.3) + 0.6 * Math.sin(t * 31.7 + 1.3)) * 0.62;
    const sy = shake * (Math.sin(t * 43.1 + 2.1) + 0.6 * Math.sin(t * 27.9 + 0.4)) * 0.62;
    this.worldLayer.scale.set(zoom);
    this.worldLayer.position.set(w / 2 - cx * zoom + sx, h / 2 - cy * zoom + sy);

    this.bg.width = w;
    this.bg.height = h;
    this.bg.tileScale.set(zoom);
    this.bg.tilePosition.set(w / 2 - cx * zoom + sx, h / 2 - cy * zoom + sy);
    this.bg.alpha = clamp((zoom - 0.25) * 2.5, 0.25, 1);

    const halfW = w / 2 / zoom + 40;
    const halfH = h / 2 / zoom + 40;
    this.renderFood(alpha, dt, cx - halfW, cy - halfH, cx + halfW, cy + halfH);
    this.hole.update(this.world, alpha, dt);
    this.renderSnakes(alpha, dt, zoom, halfW, halfH, focus.own ? focus.snake : null, showNames);
    this.deathFx.render(dt);
    this.renderOverlay(dt, w, h);
  }

  private updateCamera(alpha: number, dt: number, focus: FocusOptions, base: number): void {
    const cam = this.cam;
    const s = focus.snake;
    if (!s) return;
    const hx = lerp(s.px, s.x, alpha);
    const hy = lerp(s.py, s.y, alpha);
    let targetZoom: number;
    if (focus.own) {
      cam.x = hx;
      cam.y = hy;
      // Dev yılanlarda kamera biraz daha uzaklaşır (kalınlaşma 10k'dan sonra hızlı)
      targetZoom = clamp(Math.pow(14 / s.radius, 0.55), 0.28, 1) * base;
    } else {
      const k = 1 - Math.exp(-dt * 3);
      cam.x += (hx - cam.x) * k;
      cam.y += (hy - cam.y) * k;
      targetZoom = 0.55 * base;
    }
    if (focus.own && this.spawnZoomT < SPAWN_ZOOM_SECONDS) {
      this.spawnZoomT += dt;
      cam.zoom = lerp(0.3 * base, targetZoom, easeOutCubic(this.spawnZoomT / SPAWN_ZOOM_SECONDS));
    } else {
      cam.zoom += (targetZoom - cam.zoom) * (1 - Math.exp(-dt * 4));
    }
  }

  private renderFood(
    alpha: number,
    dt: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): void {
    const food = this.world.food;
    const tick = this.world.tick;
    const pad = food.maxRadius;
    const n = food.queryRect(minX - pad, minY - pad, maxX + pad, maxY + pad, this.foodScratch);
    const t = this.time;
    this.foodGlow.begin();
    this.deathBlob.begin();
    this.deathCore.begin();
    this.foodCore.begin();
    const hole = this.hole.active ? this.hole : null;
    for (let k = 0; k < n; k++) {
      const slot = this.foodScratch[k]!;
      if (hole?.isPulled(slot, food.id[slot]!)) continue;
      // Mıknatısla çekilen yem tick'ler arasında da akıcı kaysın
      let x = food.x[slot]!;
      let y = food.y[slot]!;
      if (food.movedAt[slot] === tick) {
        x = lerp(food.px[slot]!, x, alpha);
        y = lerp(food.py[slot]!, y, alpha);
      }
      const age = (tick - food.born[slot]! + alpha) * DT;
      const pop = Math.max(0, age) / FOOD_POP_SECONDS;
      let vis = pop < 1 ? easeOutCubic(pop) : 1;
      const expire = food.expire[slot]!;
      if (expire >= 0) vis *= clamp(((expire - tick - alpha) * DT) / FOOD_FADE_SECONDS, 0, 1);
      if (vis <= 0) continue;
      const id = food.id[slot]!;
      if (food.kind[slot] === FoodKind.Death) {
        const r = food.radius[slot]!;
        x += Math.sin(t * 1.3 + id * 2.1) * r * 0.1;
        y += Math.cos(t * 1.1 + id * 1.3) * r * 0.1;
        // Patlamadan saçılan yem bir an büyüyüp yerine oturur
        const grow = pop < 1 ? vis * (1 + 0.45 * Math.sin(Math.PI * pop)) : vis;
        this.drawDeathOrb(
          x,
          y,
          r * (1 + 0.07 * Math.sin(t * 2.4 + id)) * grow,
          food.color[slot]!,
          vis,
        );
      } else {
        const r = food.radius[slot]! * (1 + 0.1 * Math.sin(t * 3 + id * 1.7)) * vis;
        this.drawPellet(x, y, r, food.color[slot]!, vis);
      }
    }
    if (hole) {
      const rect = { minX, minY, maxX, maxY };
      hole.drawFood(this.world, alpha, rect, (slot, x, y, r) => {
        if (food.kind[slot] === FoodKind.Death) this.drawDeathOrb(x, y, r, food.color[slot]!, 1);
        else this.drawPellet(x, y, r, food.color[slot]!, 1);
      });
    }
    this.renderEatFx(alpha, dt);
    this.foodGlow.end();
    this.deathBlob.end();
    this.deathCore.end();
    this.foodCore.end();
  }

  /** Yenen yemler yiyenin kafasına doğru akarak küçülür (yılanın altında kaybolur). */
  private renderEatFx(alpha: number, dt: number): void {
    let keep = 0;
    for (const fx of this.eatFx) {
      fx.t += dt;
      const p = fx.t / EAT_SECONDS;
      if (p >= 1) continue;
      this.eatFx[keep++] = fx;
      const eater = this.world.snakes.get(fx.eaterId);
      if (eater) {
        fx.hx = lerp(eater.px, eater.x, alpha);
        fx.hy = lerp(eater.py, eater.y, alpha);
      }
      const e = 1 - (1 - p) * (1 - p);
      const x = lerp(fx.x, fx.hx, e);
      const y = lerp(fx.y, fx.hy, e);
      const vis = 1 - p;
      if (fx.death) this.drawDeathOrb(x, y, fx.radius * (1 - p * 0.7), fx.color, vis);
      else this.drawPellet(x, y, fx.radius * (1 - p * 0.7), fx.color, vis);
    }
    this.eatFx.length = keep;
  }

  private drawPellet(x: number, y: number, r: number, colorIdx: number, vis: number): void {
    const color = PALETTE[colorIdx] ?? 0xffffff;
    this.foodGlow.next(x, y, r * 2.6, color, 0.45 * vis);
    this.foodCore.next(x, y, r, color, vis);
  }

  /**
   * Ölüm yemi: yumuşak kenarlı, beyaza yakın büyük küre (içinde yılanın renginden hafif bir ton)
   * ve hafif renkli hale; üst üste binince gövde şekli çıkar.
   */
  private drawDeathOrb(x: number, y: number, r: number, colorIdx: number, vis: number): void {
    this.foodGlow.next(x, y, r * 1.9, this.deathHaloPalette[colorIdx] ?? 0xffffff, 0.3 * vis);
    // Doku kenarı yumuşak: görünen kenar gövde boncuğununkiyle (yarıçap r) aynı yere gelsin
    this.deathBlob.next(x, y, r * 1.15, this.deathBodyPalette[colorIdx] ?? 0xffffff, 0.82 * vis);
    this.deathCore.next(x, y, r * 0.55, 0xffffff, 0.6 * vis);
  }

  private renderSnakes(
    alpha: number,
    dt: number,
    zoom: number,
    halfW: number,
    halfH: number,
    own: SnakeLike | null,
    showNames: boolean,
  ): void {
    const { x: cx, y: cy } = this.cam;
    const rect = this.viewRect;
    rect.minX = cx - halfW;
    rect.minY = cy - halfH;
    rect.maxX = cx + halfW;
    rect.maxY = cy + halfH;
    const seen = this.seen;
    seen.clear();
    for (const s of this.world.snakeList) {
      // Kafa görüş alanından gövde boyundan daha uzaktaysa yılan görünmez
      const ox = Math.abs(s.x - cx) - halfW;
      const oy = Math.abs(s.y - cy) - halfH;
      if (ox > s.length || oy > s.length) continue;
      let view = this.views.get(s.id);
      if (!view) {
        view = new SnakeView(this.textures, s.name, s.color);
        this.views.set(s.id, view);
        this.snakeLayer.addChild(view.root);
      }
      view.root.zIndex = s === own ? Number.MAX_SAFE_INTEGER : s.score;
      view.update(s, alpha, dt, zoom, showNames, rect);
      seen.add(s.id);
    }
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      this.views.delete(id);
      this.fading.set(view, SNAKE_FADE_SECONDS);
    }
    // Ölen yılan anında kaybolmaz; ölüm yemleri belirirken solar
    for (const [view, left] of this.fading) {
      const next = left - dt;
      if (next <= 0) {
        this.fading.delete(view);
        view.destroy();
        continue;
      }
      this.fading.set(view, next);
      view.root.alpha = next / SNAKE_FADE_SECONDS;
    }
  }
}

function mixColor(a: number, b: number, t: number): number {
  const ch = (shift: number) =>
    Math.round(lerp((a >> shift) & 0xff, (b >> shift) & 0xff, t)) << shift;
  return ch(16) | ch(8) | ch(0);
}
