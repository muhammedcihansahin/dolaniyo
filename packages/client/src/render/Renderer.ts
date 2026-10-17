import {
  DT,
  FoodKind,
  PALETTE,
  clamp,
  easeOutCubic,
  lerp,
  type SimEvent,
  type SnakeLike,
  type World,
} from '@yilan/shared';
import { Application, Container, Graphics, TilingSprite } from 'pixi.js';
import { SnakeView } from './SnakeView';
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
  private readonly views = new Map<number, SnakeView>();
  /** Görüşten çıkmış, solarak kaybolan yılan çizimleri (kalan süre, sn). */
  private readonly fading = new Map<SnakeView, number>();
  private readonly foodScratch: number[] = [];
  private eatFx: EatFx[] = [];
  /** Ölüm yemlerinin parlak merkezi için paletin beyaza yaklaştırılmış hali. */
  private readonly lightPalette = PALETTE.map((c) => mixColor(c, 0xffffff, 0.55));
  private time = 0;
  private spawnZoomT = SPAWN_ZOOM_SECONDS;

  constructor(
    private readonly app: Application,
    private readonly world: World,
  ) {
    this.textures = createTextures();
    this.bg = new TilingSprite({ texture: this.textures.hexTile, width: 1, height: 1 });
    app.stage.addChild(this.bg, this.worldLayer);

    const R = world.cfg.arenaRadius;
    const outside = new Graphics()
      .rect(-R * 4, -R * 4, R * 8, R * 8)
      .fill({ color: 0x000000, alpha: 0.55 })
      .circle(0, 0, R + 20)
      .cut();
    const border = new Graphics()
      .circle(0, 0, R + 20)
      .stroke({ width: 140, color: BORDER_COLOR, alpha: 0.1 })
      .circle(0, 0, R + 20)
      .stroke({ width: 40, color: BORDER_COLOR, alpha: 0.9 });

    const foodGlowLayer = new Container({ blendMode: 'add' });
    const deathLayer = new Container();
    const foodLayer = new Container();
    this.foodGlow = new SpritePool(foodGlowLayer, this.textures.glow);
    this.deathBlob = new SpritePool(deathLayer.addChild(new Container()), this.textures.blob);
    this.deathCore = new SpritePool(deathLayer.addChild(new Container()), this.textures.blob);
    this.foodCore = new SpritePool(foodLayer, this.textures.circle);
    this.worldLayer.addChild(
      outside,
      foodGlowLayer,
      deathLayer,
      foodLayer,
      this.snakeLayer,
      border,
    );
  }

  /** Oyuncu doğduğunda uzaktan yakınlaşma animasyonunu başlatır. */
  startSpawnZoom(): void {
    this.spawnZoomT = 0;
  }

  /** Simülasyon olaylarından görsel efektler üretir (her tick'ten sonra çağrılır). */
  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type !== 'foodEaten') continue;
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

  render(alpha: number, dt: number, focus: FocusOptions, showNames: boolean): void {
    this.time += dt;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const base = Math.min(w, h) / 900;
    this.updateCamera(alpha, dt, focus, base);

    const { x: cx, y: cy, zoom } = this.cam;
    this.worldLayer.scale.set(zoom);
    this.worldLayer.position.set(w / 2 - cx * zoom, h / 2 - cy * zoom);

    this.bg.width = w;
    this.bg.height = h;
    this.bg.tileScale.set(zoom);
    this.bg.tilePosition.set(w / 2 - cx * zoom, h / 2 - cy * zoom);
    this.bg.alpha = clamp((zoom - 0.25) * 2.5, 0.25, 1);

    const halfW = w / 2 / zoom + 40;
    const halfH = h / 2 / zoom + 40;
    this.renderFood(alpha, dt, cx - halfW, cy - halfH, cx + halfW, cy + halfH);
    this.renderSnakes(alpha, dt, zoom, halfW, halfH, focus.own ? focus.snake : null, showNames);
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
      targetZoom = clamp(Math.pow(14 / s.radius, 0.55), 0.35, 1) * base;
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
    for (let k = 0; k < n; k++) {
      const slot = this.foodScratch[k]!;
      // Mıknatısla çekilen yem tick'ler arasında da akıcı kaysın
      let x = food.x[slot]!;
      let y = food.y[slot]!;
      if (food.movedAt[slot] === tick) {
        x = lerp(food.px[slot]!, x, alpha);
        y = lerp(food.py[slot]!, y, alpha);
      }
      const age = (tick - food.born[slot]! + alpha) * DT;
      let vis = age < FOOD_POP_SECONDS ? easeOutCubic(Math.max(0, age) / FOOD_POP_SECONDS) : 1;
      const expire = food.expire[slot]!;
      if (expire >= 0) vis *= clamp(((expire - tick - alpha) * DT) / FOOD_FADE_SECONDS, 0, 1);
      if (vis <= 0) continue;
      const id = food.id[slot]!;
      if (food.kind[slot] === FoodKind.Death) {
        const r = food.radius[slot]!;
        x += Math.sin(t * 1.3 + id * 2.1) * r * 0.1;
        y += Math.cos(t * 1.1 + id * 1.3) * r * 0.1;
        this.drawDeathOrb(
          x,
          y,
          r * (1 + 0.07 * Math.sin(t * 2.4 + id)) * vis,
          food.color[slot]!,
          vis,
        );
      } else {
        const r = food.radius[slot]! * (1 + 0.1 * Math.sin(t * 3 + id * 1.7)) * vis;
        this.drawPellet(x, y, r, food.color[slot]!, vis);
      }
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

  /** Ölüm yemi: yumuşak kenarlı, parlak merkezli büyük küre; üst üste binince gövde şekli çıkar. */
  private drawDeathOrb(x: number, y: number, r: number, colorIdx: number, vis: number): void {
    const color = PALETTE[colorIdx] ?? 0xffffff;
    this.foodGlow.next(x, y, r * 1.9, color, 0.3 * vis);
    this.deathBlob.next(x, y, r, color, 0.8 * vis);
    this.deathCore.next(x, y, r * 0.55, this.lightPalette[colorIdx] ?? 0xffffff, 0.55 * vis);
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
    const seen = new Set<number>();
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
      view.update(s, alpha, dt, zoom, showNames);
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
