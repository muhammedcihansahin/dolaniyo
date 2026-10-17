import { Texture } from 'pixi.js';

/** Üretilen dairesel dokuların piksel yarıçapı; sprite ölçeği = istenen yarıçap / TEX_RADIUS. */
export const TEX_RADIUS = 32;

export interface GameTextures {
  circle: Texture;
  bead: Texture;
  soft: Texture;
  glow: Texture;
  /** Kenarları yumuşak dolu disk (ölüm yemi). */
  blob: Texture;
  hexTile: Texture;
  /** Altıgen kenar uzunluğu (dünya birimi = doku pikseli). */
  hexSide: number;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function radial(stops: [number, string][]): Texture {
  const size = TEX_RADIUS * 2 + 4;
  const [c, ctx] = makeCanvas(size, size);
  const m = size / 2;
  const g = ctx.createRadialGradient(m, m, 0, m, m, TEX_RADIUS);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(m, m, TEX_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  return Texture.from(c);
}

/**
 * Düz-üst (flat-top) altıgen ızgaranın tekrarlanabilir karesi: kenarlar noktalı çizgi,
 * arkada çok ince düzenli nokta dokusu. Doku kenarları birebir eşleşir.
 */
function hexTile(side: number): Texture {
  const h = Math.sqrt(3) * side;
  const W = Math.round(3 * side);
  const H = Math.round(h);
  const [c, ctx] = makeCanvas(W, H);
  ctx.scale(W / (3 * side), H / h);

  // ince nokta dokusu
  ctx.fillStyle = 'rgba(140, 170, 230, 0.07)';
  const fine = 6;
  for (let y = fine / 2; y < h; y += h / Math.round(h / fine)) {
    for (let x = fine / 2; x < 3 * side; x += (3 * side) / Math.round((3 * side) / fine)) {
      ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
    }
  }

  // altıgen kenarları, kenar başına eşit aralıklı noktalar (komşu altıgenlerle aynı konumlar)
  const dotsPerEdge = 11;
  ctx.fillStyle = 'rgba(127, 167, 224, 0.5)';
  const corners: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k;
    corners.push([Math.cos(a) * side, Math.sin(a) * side]);
  }
  for (let col = -1; col <= 3; col++) {
    for (let row = -1; row <= 2; row++) {
      const cx = col * 1.5 * side;
      const cy = row * h + (col & 1 ? h / 2 : 0);
      for (let k = 0; k < 6; k++) {
        const [ax, ay] = corners[k]!;
        const [bx, by] = corners[(k + 1) % 6]!;
        for (let d = 0; d < dotsPerEdge; d++) {
          const t = d / dotsPerEdge;
          ctx.beginPath();
          ctx.arc(cx + ax + (bx - ax) * t, cy + ay + (by - ay) * t, 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  return Texture.from(c);
}

export function createTextures(): GameTextures {
  const hexSide = 104;
  return {
    circle: radial([
      [0, '#fff'],
      [0.94, '#fff'],
      [1, 'rgba(255,255,255,0)'],
    ]),
    bead: radial([
      [0, '#fff'],
      [0.45, '#f4f4f4'],
      [0.9, '#b8b8b8'],
      [1, 'rgba(184,184,184,0)'],
    ]),
    soft: radial([
      [0, '#fff'],
      [0.72, '#fff'],
      [1, 'rgba(255,255,255,0)'],
    ]),
    glow: radial([
      [0, 'rgba(255,255,255,0.9)'],
      [0.35, 'rgba(255,255,255,0.35)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
    blob: radial([
      [0, '#fff'],
      [0.45, 'rgba(255,255,255,0.95)'],
      [0.75, 'rgba(255,255,255,0.6)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
    hexTile: hexTile(hexSide),
    hexSide,
  };
}
