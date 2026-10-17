import type { SnakeLike } from '@yilan/shared';

/** Yılan yolundan alınmış sabit aralıklı örnekler (0 = kafa). */
export class PathSamples {
  xs = new Float32Array(256);
  ys = new Float32Array(256);
  arcs = new Float32Array(256);
  n = 0;

  push(x: number, y: number, arc: number): void {
    if (this.n >= this.xs.length) {
      const grow = (a: Float32Array) => {
        const b = new Float32Array(a.length * 2);
        b.set(a);
        return b;
      };
      this.xs = grow(this.xs);
      this.ys = grow(this.ys);
      this.arcs = grow(this.arcs);
    }
    this.xs[this.n] = x;
    this.ys[this.n] = y;
    this.arcs[this.n] = arc;
    this.n++;
  }
}

/**
 * İnterpolasyonlu kafa (hx, hy)'den başlayıp gövde noktalarını izleyerek her `step` birimde
 * bir örnek alır; toplam uzunluk yılanın boyuyla sınırlı.
 * Gerçek kafa ile interpolasyonlu kafa arasında kalan (henüz "geçilmemiş") noktalar atlanır.
 */
export function samplePath(s: SnakeLike, hx: number, hy: number, step: number, out: PathSamples) {
  out.n = 0;
  const b = s.body;
  const n = b.count;
  const sp = b.spacing;
  const skip = Math.sqrt((s.x - hx) ** 2 + (s.y - hy) ** 2);
  const d0 = b.headGap(s.x, s.y);
  const maxLen = s.length;

  let i = 0;
  while (i < n && d0 + i * sp <= skip) i++;

  let ax = hx;
  let ay = hy;
  let walked = 0;
  let nextAt = step;
  out.push(hx, hy, 0);
  for (; i < n; i++) {
    const bx = b.x(i);
    const by = b.y(i);
    const seg = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
    if (seg > 0) {
      while (nextAt <= walked + seg && nextAt <= maxLen) {
        const t = (nextAt - walked) / seg;
        out.push(ax + (bx - ax) * t, ay + (by - ay) * t, nextAt);
        nextAt += step;
      }
      walked += seg;
    }
    if (walked >= maxLen) break;
    ax = bx;
    ay = by;
  }
}
