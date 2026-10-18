import { PALETTE, TAU, clamp, easeOutCubic } from '@yilan/shared';
import { Container, Text } from 'pixi.js';
import { t } from '../i18n';
import { SpritePool } from './SpritePool';
import type { GameTextures } from './textures';

/** Patlama dalgasının baştan kuyruğa yayılma süresi (sn), gövde uzunluğuyla uzar. */
const SWEEP_MIN = 0.12;
const SWEEP_MAX = 0.5;
const SWEEP_PER_UNIT = 1 / 2400;
/** Gövdedeki tek bir noktanın patlayıp sönme süresi. */
const POP_SECONDS = 0.42;
/** Kafadaki şok dalgası halkalarının genişleme süresi ve aralarındaki gecikme. */
const RING_SECONDS = 0.6;
const RING_GAP = 0.09;
const HEAD_FLASH_SECONDS = 0.3;
/** Tek patlamadaki en fazla patlama noktası (çok uzun yılanlarda aralık açılır). */
const MAX_POPS = 140;
/** Patlama başına hedeflenen kıvılcım sayısı (güç ile çarpılır) ve ekrandaki üst sınır. */
const SPARKS_PER_BURST = 190;
const MAX_SPARKS = 1800;
/** Kıvılcım hız sönümü (1/sn): hızlı fırlar, çabuk yavaşlar. */
const SPARK_DRAG = 3.4;

const KILL_BANNER_SECONDS = 1.6;
/** Bu süre içindeki öldürmeler seri sayılır (çifte, üçlü…). */
const STREAK_WINDOW = 4;
const STREAK_COLORS = [0xffe14d, 0xffe14d, 0xffa94d, 0xff7ab8, 0xff4d5e];

interface Burst {
  xs: Float32Array;
  ys: Float32Array;
  /** Her noktanın patlama anı (sn, patlamanın başından itibaren). */
  delay: Float32Array;
  n: number;
  radius: number;
  colorIdx: number;
  /** 1 = sıradan ölüm; oyuncunun öldürdüğü ya da kendi ölümü daha güçlü. */
  power: number;
  sparksPerPop: number;
  t: number;
  /** Kıvılcımı henüz saçılmamış ilk nokta. */
  next: number;
  end: number;
}

/**
 * Ölüm efektleri (yalnızca görsel, eklemeli karışım): gövde boyunca baştan kuyruğa yayılan
 * zincirleme patlama, her patlamadan saçılan kuyruklu kıvılcımlar, kafada parlama ve
 * genişleyen şok dalgası halkaları.
 */
export class DeathFx {
  readonly layer = new Container({ blendMode: 'add' });
  private readonly pops: SpritePool;
  private readonly sparks: SpritePool;
  private readonly rings: SpritePool;
  private bursts: Burst[] = [];
  /** Kıvılcımlar yapı-dizisi olarak tutulur (her karede nesne üretilmez). */
  private readonly sx = new Float32Array(MAX_SPARKS);
  private readonly sy = new Float32Array(MAX_SPARKS);
  private readonly svx = new Float32Array(MAX_SPARKS);
  private readonly svy = new Float32Array(MAX_SPARKS);
  private readonly sAge = new Float32Array(MAX_SPARKS);
  private readonly sLife = new Float32Array(MAX_SPARKS);
  private readonly sSize = new Float32Array(MAX_SPARKS);
  private readonly sColor = new Uint32Array(MAX_SPARKS);
  private sparkCount = 0;
  /** Patlama ışığı: yılan renginden beyaza kaymış ton. */
  private readonly lightPalette = PALETTE.map((c) => mix(c, 0xffffff, 0.55));

  constructor(textures: GameTextures) {
    this.pops = new SpritePool(this.layer, textures.glow);
    this.sparks = new SpritePool(this.layer, textures.glow, true);
    this.rings = new SpritePool(this.layer, textures.ring);
  }

  /**
   * Ölen yılanın son çizilen gövdesinde patlama başlatır. `xs/ys/arcs`: kafadan kuyruğa
   * gövde örnekleri ve kafadan yol uzaklıkları.
   */
  burst(
    xs: ArrayLike<number>,
    ys: ArrayLike<number>,
    arcs: ArrayLike<number>,
    count: number,
    radius: number,
    colorIdx: number,
    power: number,
  ): void {
    if (count <= 0) return;
    const spacing = count > 1 ? arcs[1]! - arcs[0]! : 1;
    const stride = Math.max(
      1,
      Math.round((radius * 0.8) / Math.max(spacing, 1e-3)),
      Math.ceil(count / MAX_POPS),
    );
    const n = Math.ceil(count / stride);
    const length = arcs[count - 1]! || 1;
    const sweep = clamp(length * SWEEP_PER_UNIT, SWEEP_MIN, SWEEP_MAX);
    const b: Burst = {
      xs: new Float32Array(n),
      ys: new Float32Array(n),
      delay: new Float32Array(n),
      n,
      radius,
      colorIdx,
      power,
      sparksPerPop: clamp(Math.round((SPARKS_PER_BURST * power) / n), 1, 6),
      t: 0,
      next: 0,
      end: Math.max(sweep + POP_SECONDS, RING_GAP * 2 + RING_SECONDS),
    };
    for (let i = 0, j = 0; i < n; i++, j += stride) {
      b.xs[i] = xs[j]!;
      b.ys[i] = ys[j]!;
      b.delay[i] = (arcs[j]! / length) * sweep;
    }
    this.bursts.push(b);
  }

  clear(): void {
    this.bursts = [];
    this.sparkCount = 0;
  }

  render(dt: number): void {
    this.pops.begin();
    this.rings.begin();
    let keep = 0;
    for (const b of this.bursts) {
      b.t += dt;
      while (b.next < b.n && b.delay[b.next]! <= b.t) this.emitSparks(b, b.next++);
      if (b.t >= b.end) continue;
      this.bursts[keep++] = b;
      this.drawBurst(b);
    }
    this.bursts.length = keep;
    this.pops.end();
    this.rings.end();
    this.renderSparks(dt);
  }

  private drawBurst(b: Burst): void {
    const r = b.radius;
    const light = this.lightPalette[b.colorIdx] ?? 0xffffff;
    const color = PALETTE[b.colorIdx] ?? 0xffffff;
    // Zincirleme patlama: her nokta sırası gelince büyüyerek parlar, beyaz sıcak çekirdek önce söner
    for (let i = 0; i < b.n; i++) {
      const u = b.t - b.delay[i]!;
      if (u < 0) break; // gecikmeler sıralı
      const p = u / POP_SECONDS;
      if (p >= 1) continue;
      const e = easeOutCubic(p);
      const fade = (1 - p) * (1 - p);
      this.pops.next(b.xs[i]!, b.ys[i]!, r * (1 + 1.7 * e), light, 0.8 * fade);
      if (p < 0.35) {
        const q = p / 0.35;
        this.pops.next(b.xs[i]!, b.ys[i]!, r * (1.1 - 0.5 * q), 0xffffff, 0.95 * (1 - q));
      }
    }
    // Kafa: büyük beyaz parlama + iki-üç şok dalgası halkası
    const hx = b.xs[0]!;
    const hy = b.ys[0]!;
    const hp = b.t / HEAD_FLASH_SECONDS;
    if (hp < 1) {
      this.pops.next(
        hx,
        hy,
        r * (2.2 + 2.6 * easeOutCubic(hp)) * b.power,
        0xffffff,
        0.9 * (1 - hp) ** 2,
      );
    }
    const rings = b.power > 1 ? 3 : 2;
    const reach = 5 + 3 * (b.power - 1);
    for (let k = 0; k < rings; k++) {
      const u = (b.t - k * RING_GAP) / RING_SECONDS;
      if (u < 0 || u >= 1) continue;
      const rr = r * (1.4 + reach * easeOutCubic(u)) * (1 - k * 0.12);
      this.rings.next(
        hx,
        hy,
        rr,
        k === 0 ? 0xffffff : k === 1 ? light : color,
        0.9 * (1 - u) ** 1.6,
      );
    }
  }

  private emitSparks(b: Burst, i: number): void {
    const r = b.radius;
    const speedK = clamp(Math.sqrt(r / 14), 1, 2.6) * Math.sqrt(b.power);
    const color = PALETTE[b.colorIdx] ?? 0xffffff;
    const light = this.lightPalette[b.colorIdx] ?? 0xffffff;
    for (let k = 0; k < b.sparksPerPop; k++) {
      if (this.sparkCount >= MAX_SPARKS) return;
      const s = this.sparkCount++;
      const a = Math.random() * TAU;
      const v = (110 + Math.random() * 380) * speedK;
      const jitter = r * 0.5;
      this.sx[s] = b.xs[i]! + (Math.random() - 0.5) * jitter;
      this.sy[s] = b.ys[i]! + (Math.random() - 0.5) * jitter;
      this.svx[s] = Math.cos(a) * v;
      this.svy[s] = Math.sin(a) * v;
      this.sAge[s] = 0;
      this.sLife[s] = 0.45 + Math.random() * 0.55;
      this.sSize[s] = r * (0.13 + Math.random() * 0.2);
      const pick = Math.random();
      this.sColor[s] = pick < 0.45 ? color : pick < 0.8 ? light : 0xffffff;
    }
  }

  /** Kıvılcımlar hızlarıyla orantılı uzayan kuyruklu ışıklar; yavaşladıkça yuvarlaklaşıp söner. */
  private renderSparks(dt: number): void {
    const drag = Math.exp(-dt * SPARK_DRAG);
    this.sparks.begin();
    let keep = 0;
    for (let i = 0; i < this.sparkCount; i++) {
      const age = this.sAge[i]! + dt;
      const life = this.sLife[i]!;
      if (age >= life) continue;
      const vx = this.svx[i]! * drag;
      const vy = this.svy[i]! * drag;
      const x = this.sx[i]! + vx * dt;
      const y = this.sy[i]! + vy * dt;
      this.sx[keep] = x;
      this.sy[keep] = y;
      this.svx[keep] = vx;
      this.svy[keep] = vy;
      this.sAge[keep] = age;
      this.sLife[keep] = life;
      this.sSize[keep] = this.sSize[i]!;
      this.sColor[keep] = this.sColor[i]!;
      keep++;
      const f = age / life;
      const size = this.sSize[i]! * (1.5 - f);
      const spark = this.sparks.next(x, y, size, this.sColor[i]!, (1 - f) ** 1.3);
      const speed = Math.sqrt(vx * vx + vy * vy);
      spark.rotation = Math.atan2(vy, vx);
      spark.scaleX *= 1 + Math.min(3.5, speed / 140);
    }
    this.sparkCount = keep;
    this.sparks.end();
  }
}

/**
 * Oyuncu birini öldürünce ekranın üst ortasında beliren yazı: "ELENDİ!" ve rakibin adı;
 * kısa sürede art arda öldürmelerde "ÇİFTE ÖLDÜRME!", "ÜÇLÜ ÖLDÜRME!", "SERİ ×4!".
 */
export class KillBanner {
  readonly root = new Container();
  private readonly title: Text;
  private readonly name: Text;
  private t = Infinity;
  private clock = 0;
  private lastKillAt = -Infinity;
  private streak = 0;

  constructor() {
    this.title = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, Segoe UI, sans-serif',
        fontSize: 46,
        fontWeight: '900',
        fill: 0xffe14d,
        letterSpacing: 2,
        stroke: { color: 0x05070d, width: 7, join: 'round' },
        dropShadow: { color: 0xffe14d, alpha: 0.55, blur: 16, distance: 0, angle: 0 },
      },
      resolution: 2,
    });
    this.title.anchor.set(0.5, 1);
    this.name = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, Segoe UI, sans-serif',
        fontSize: 24,
        fontWeight: '700',
        fill: 0xffffff,
        stroke: { color: 0x05070d, width: 5, join: 'round' },
        dropShadow: { color: 0x000000, alpha: 0.5, blur: 6, distance: 0, angle: 0 },
      },
      resolution: 2,
    });
    this.name.anchor.set(0.5, 0);
    this.name.y = 4;
    this.root.addChild(this.title, this.name);
    this.root.visible = false;
  }

  show(victim: string, colorIdx: number): void {
    this.streak = this.clock - this.lastKillAt < STREAK_WINDOW ? this.streak + 1 : 1;
    this.lastKillAt = this.clock;
    const s = this.streak;
    this.title.text =
      s >= 4
        ? t('fx.streak', { n: s })
        : s === 3
          ? t('fx.triple')
          : s === 2
            ? t('fx.double')
            : t('fx.kill');
    const c = STREAK_COLORS[Math.min(s, STREAK_COLORS.length - 1)]!;
    this.title.style.fill = c;
    this.title.style.dropShadow = { color: c, alpha: 0.55, blur: 16, distance: 0, angle: 0 };
    this.name.text = victim;
    this.name.style.fill = mix(PALETTE[colorIdx] ?? 0xffffff, 0xffffff, 0.3);
    this.t = 0;
  }

  /** Yeni hayatta seri sıfırlanır. */
  reset(): void {
    this.streak = 0;
    this.lastKillAt = -Infinity;
    this.t = Infinity;
    this.root.visible = false;
  }

  update(dt: number, w: number, h: number): void {
    this.clock += dt;
    this.t += dt;
    const left = KILL_BANNER_SECONDS - this.t;
    this.root.visible = left > 0;
    if (left <= 0) return;
    const ui = clamp(Math.min(w, h) / 900, 0.6, 1.3);
    const p = this.t / 0.3;
    // Fırlayarak büyür (hafif taşma), sonra yavaşça yükselip söner
    const pop =
      p < 1 ? easeOutBack(p) : 1 + 0.03 * Math.sin((this.t - 0.3) * 9) * Math.max(0, 1 - this.t);
    this.root.scale.set(ui * (0.4 + 0.6 * pop));
    this.root.alpha = Math.min(1, left / 0.45, this.t / 0.06);
    this.root.position.set(w / 2, h * 0.24 - this.t * 14 * ui);
  }
}

function easeOutBack(p: number): number {
  const c1 = 1.9;
  const u = p - 1;
  return 1 + (c1 + 1) * u * u * u + c1 * u * u;
}

export function mix(a: number, b: number, k: number): number {
  const ch = (shift: number) => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * k) << shift;
  };
  return ch(16) | ch(8) | ch(0);
}
