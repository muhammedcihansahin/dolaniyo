import { PALETTE, TAU, lerp, lerpAngle, type SnakeLike } from '@yilan/shared';
import { Container, Text } from 'pixi.js';
import { PathSamples, samplePath } from './path';
import { SpritePool } from './SpritePool';
import type { GameTextures } from './textures';

const TUBE_COLOR = 0x05070d;
const PUPIL_COLOR = 0x0a0f1e;
/** Boncukların baştan kuyruğa akan büyüme-küçülme dalgası. */
const BEAD_BASE = 0.42;
const WAVE_AMP = 0.28;
/** Dalga boyu, yılan yarıçapı cinsinden (~20 boncuk). */
const WAVE_LENGTH = 18;
/** rad/sn; hızlanırken dalga da hızlanır. */
const WAVE_SPEED = 5.5;
const WAVE_SPEED_BOOST = 11;
/** Baş, gövdeden bu oranda geniş çizilir (yalnızca görünüm; çarpışma aynı). */
const HEAD_SCALE = 1.18;
/** Baştaki genişlik kafadan bu kadar yarıçap geride gövde kalınlığına iner. */
const HEAD_NECK = 1.6;
/** En geniş çizim (kafadaki parlama) yarıçapı, r cinsinden: ekran kırpmasının payı. */
const DRAW_PAD = HEAD_SCALE * 1.28;

/** Görüş alanı (dünya birimi); tamamen dışında kalan gövde parçaları çizilmez. */
export interface ViewRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Tek bir yılanın çizimi: dış parlak kontur → koyu tüp → renkli boncuklar → kafa ve gözler.
 * Katmanlar ayrı kaplarda olduğu için kontur her zaman tüpün altında kalır.
 */
export class SnakeView {
  readonly root = new Container();
  private readonly glow: SpritePool;
  private readonly tube: SpritePool;
  private readonly beads: SpritePool;
  private readonly head: SpritePool;
  private readonly nameText: Text;
  /** Son karede çizilen gövde örnekleri (ölüm parlaması bunları kullanır). */
  readonly tubeSamples = new PathSamples();
  private readonly beadSamples = new PathSamples();
  private readonly color: number;
  /** Son karede çizilen yarıçap; henüz çizilmediyse 0. */
  radius = 0;
  private wave = 0;
  /** Hızlanma görünümü (0..1): parlama ve dalga hızı boost'a anında değil yumuşakça geçer. */
  private boostVis = 0;

  constructor(
    textures: GameTextures,
    name: string,
    readonly colorIdx: number,
  ) {
    this.color = PALETTE[colorIdx] ?? 0xffffff;
    this.glow = new SpritePool(this.root, textures.soft);
    this.tube = new SpritePool(this.root, textures.circle);
    this.beads = new SpritePool(this.root, textures.bead);
    this.head = new SpritePool(this.root, textures.circle);
    this.nameText = new Text({
      text: name,
      style: { fontFamily: 'system-ui, Segoe UI, sans-serif', fontSize: 15, fill: 0xffffff },
      resolution: 2,
    });
    this.nameText.anchor.set(0.5, 0);
    this.nameText.alpha = 0.75;
    this.root.addChild(this.nameText);
  }

  update(
    s: SnakeLike,
    alpha: number,
    dt: number,
    zoom: number,
    showName: boolean,
    view: ViewRect,
  ): void {
    const hx = lerp(s.px, s.x, alpha);
    const hy = lerp(s.py, s.y, alpha);
    const ha = lerpAngle(s.pangle, s.angle, alpha);
    const r = s.radius;
    const len = s.length;
    const color = this.color;
    this.radius = r;

    // Gövde örnekleri tam alınır (ölüm patlaması tüm gövdeyi kullanır), çizim ekranla sınırlı
    const pad = r * DRAW_PAD;
    const x0 = view.minX - pad;
    const y0 = view.minY - pad;
    const x1 = view.maxX + pad;
    const y1 = view.maxY + pad;

    const ts = this.tubeSamples;
    samplePath(s, hx, hy, Math.max(3, r * 0.4), ts);
    this.boostVis += ((s.boosting ? 1 : 0) - this.boostVis) * (1 - Math.exp(-dt * 9));
    const glowAlpha = lerp(0.5, 0.9, this.boostVis);
    this.glow.begin();
    this.tube.begin();
    for (let j = ts.n - 1; j >= 0; j--) {
      const x = ts.xs[j]!;
      const y = ts.ys[j]!;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const rr = r * widthAt(ts.arcs[j]!, r);
      this.glow.next(x, y, rr * 1.28, color, glowAlpha);
      this.tube.next(x, y, rr, TUBE_COLOR);
    }
    this.glow.end();
    this.tube.end();

    const bs = this.beadSamples;
    samplePath(s, hx, hy, r * 0.9, bs);
    this.wave = (this.wave + dt * lerp(WAVE_SPEED, WAVE_SPEED_BOOST, this.boostVis)) % TAU;
    const waveK = TAU / (r * WAVE_LENGTH);
    this.beads.begin();
    for (let j = bs.n - 1; j >= 1; j--) {
      const x = bs.xs[j]!;
      const y = bs.ys[j]!;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const f = bs.arcs[j]! / len;
      const pulse = 1 + WAVE_AMP * Math.sin(bs.arcs[j]! * waveK - this.wave);
      this.beads.next(
        x,
        y,
        r * BEAD_BASE * pulse * widthAt(bs.arcs[j]!, r),
        color,
        f > 0.85 ? 1 - (f - 0.85) * 4 : 1,
      );
    }
    this.beads.end();

    // Kafa: renkli disk + hedef yöne bakan iki göz (gövdeden biraz büyük)
    const hr = r * HEAD_SCALE;
    const fx = Math.cos(ha);
    const fy = Math.sin(ha);
    const look = s.targetAngle;
    const lx = Math.cos(look) * hr * 0.07;
    const ly = Math.sin(look) * hr * 0.07;
    this.head.begin();
    this.head.next(hx, hy, hr * 0.62, color);
    for (let side = -1; side <= 1; side += 2) {
      const ex = hx + fx * hr * 0.2 - fy * side * hr * 0.3;
      const ey = hy + fy * hr * 0.2 + fx * side * hr * 0.3;
      this.head.next(ex + lx, ey + ly, hr * 0.19, PUPIL_COLOR);
      this.head.next(ex + lx * 1.8 - hr * 0.05, ey + ly * 1.8 - hr * 0.05, hr * 0.06, 0xffffff);
    }
    this.head.end();

    this.nameText.visible = showName;
    if (showName) {
      this.nameText.position.set(hx, hy + hr + 10 / zoom);
      this.nameText.scale.set(1 / zoom);
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

/**
 * Gövde kalınlığı çarpanı, kafadan yol uzaklığına göre: kafa HEAD_SCALE kadar şişkin,
 * HEAD_NECK × r geride gövde kalınlığına iner. Kuyruk incelmez; son daire onu yuvarlak bitirir.
 */
function widthAt(arc: number, r: number): number {
  const t = arc / (r * HEAD_NECK);
  if (t >= 1) return 1;
  const u = 1 - t;
  return 1 + (HEAD_SCALE - 1) * u * u * (3 - 2 * u);
}
