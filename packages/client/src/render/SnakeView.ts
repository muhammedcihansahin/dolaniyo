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
  private readonly tubeSamples = new PathSamples();
  private readonly beadSamples = new PathSamples();
  private readonly color: number;
  private wave = 0;

  constructor(textures: GameTextures, name: string, colorIdx: number) {
    this.color = PALETTE[colorIdx] ?? 0xffffff;
    const layer = () => this.root.addChild(new Container());
    this.glow = new SpritePool(layer(), textures.soft);
    this.tube = new SpritePool(layer(), textures.circle);
    this.beads = new SpritePool(layer(), textures.bead);
    this.head = new SpritePool(layer(), textures.circle);
    this.nameText = new Text({
      text: name,
      style: { fontFamily: 'system-ui, Segoe UI, sans-serif', fontSize: 15, fill: 0xffffff },
      resolution: 2,
    });
    this.nameText.anchor.set(0.5, 0);
    this.nameText.alpha = 0.75;
    this.root.addChild(this.nameText);
  }

  update(s: SnakeLike, alpha: number, dt: number, zoom: number, showName: boolean): void {
    const hx = lerp(s.px, s.x, alpha);
    const hy = lerp(s.py, s.y, alpha);
    const ha = lerpAngle(s.pangle, s.angle, alpha);
    const r = s.radius;
    const len = s.length;
    const color = this.color;

    const ts = this.tubeSamples;
    samplePath(s, hx, hy, Math.max(3, r * 0.4), ts);
    const glowAlpha = s.boosting ? 0.9 : 0.5;
    this.glow.begin();
    this.tube.begin();
    for (let j = ts.n - 1; j >= 0; j--) {
      const rr = r * taper(ts.arcs[j]! / len);
      this.glow.next(ts.xs[j]!, ts.ys[j]!, rr * 1.28, color, glowAlpha);
      this.tube.next(ts.xs[j]!, ts.ys[j]!, rr, TUBE_COLOR);
    }
    this.glow.end();
    this.tube.end();

    const bs = this.beadSamples;
    samplePath(s, hx, hy, r * 0.9, bs);
    this.wave = (this.wave + dt * (s.boosting ? WAVE_SPEED_BOOST : WAVE_SPEED)) % TAU;
    const waveK = TAU / (r * WAVE_LENGTH);
    this.beads.begin();
    for (let j = bs.n - 1; j >= 1; j--) {
      const f = bs.arcs[j]! / len;
      const pulse = 1 + WAVE_AMP * Math.sin(bs.arcs[j]! * waveK - this.wave);
      this.beads.next(
        bs.xs[j]!,
        bs.ys[j]!,
        r * BEAD_BASE * pulse * taper(f),
        color,
        f > 0.85 ? 1 - (f - 0.85) * 4 : 1,
      );
    }
    this.beads.end();

    // Kafa: renkli disk + hedef yöne bakan iki göz
    const fx = Math.cos(ha);
    const fy = Math.sin(ha);
    const look = s.targetAngle;
    const lx = Math.cos(look) * r * 0.07;
    const ly = Math.sin(look) * r * 0.07;
    this.head.begin();
    this.head.next(hx, hy, r * 0.62, color);
    for (const side of [-1, 1]) {
      const ex = hx + fx * r * 0.2 - fy * side * r * 0.3;
      const ey = hy + fy * r * 0.2 + fx * side * r * 0.3;
      this.head.next(ex + lx, ey + ly, r * 0.19, PUPIL_COLOR);
      this.head.next(ex + lx * 1.8 - r * 0.05, ey + ly * 1.8 - r * 0.05, r * 0.06, 0xffffff);
    }
    this.head.end();

    this.nameText.visible = showName;
    if (showName) {
      this.nameText.position.set(hx, hy + r + 10 / zoom);
      this.nameText.scale.set(1 / zoom);
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

/** Kuyruğun son %15'inde incelme. */
function taper(f: number): number {
  return f > 0.85 ? 1 - ((f - 0.85) / 0.15) * 0.45 : 1;
}
