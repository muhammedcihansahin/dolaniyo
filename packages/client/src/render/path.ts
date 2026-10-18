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
 *
 * Gövde noktaları birbirinden tam `spacing` uzaklıkta durur (Body.advance/reset böyle kurar,
 * çarpışma ızgarası da aynı varsayımı kullanır). Bu yüzden yol nokta nokta yürünmez: her
 * örneğin hangi iki nokta arasına düştüğü doğrudan hesaplanır. Maliyet gövde uzunluğuna
 * değil örnek sayısına bağlıdır.
 */
export function samplePath(s: SnakeLike, hx: number, hy: number, step: number, out: PathSamples) {
  out.n = 0;
  const b = s.body;
  const n = b.count;
  const sp = b.spacing;
  const skip = Math.sqrt((s.x - hx) ** 2 + (s.y - hy) ** 2);
  const d0 = b.headGap(s.x, s.y);

  let i0 = 0;
  while (i0 < n && d0 + i0 * sp <= skip) i0++;

  out.push(hx, hy, 0);
  if (i0 >= n) return;
  // İlk parça interpolasyonlu kafadan i0. noktaya; sonrakilerin her biri `sp` uzunluğunda
  const ax = b.x(i0);
  const ay = b.y(i0);
  const seg0 = Math.sqrt((ax - hx) ** 2 + (ay - hy) ** 2);
  const end = Math.min(s.length, seg0 + (n - 1 - i0) * sp);
  const last = n - 2;
  for (let arc = step; arc <= end; arc += step) {
    if (arc <= seg0) {
      const t = arc / seg0;
      out.push(hx + (ax - hx) * t, hy + (ay - hy) * t, arc);
      continue;
    }
    const f = (arc - seg0) / sp;
    const i = Math.min(i0 + Math.floor(f), last);
    const t = f - (i - i0);
    const px = b.x(i);
    const py = b.y(i);
    out.push(px + (b.x(i + 1) - px) * t, py + (b.y(i + 1) - py) * t, arc);
  }
}
