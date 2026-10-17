/**
 * Yılan gövdesi: kafanın izlediği yol, sabit aralıklı noktalar olarak tutulur.
 * Halka tampon: i = 0 kafaya en yakın (en yeni) nokta, i = count-1 kuyruk.
 *
 * Noktalar yalnızca kafa konumlarından ve sabit aralıktan türetildiği için, aynı kafa
 * konumlarını alan istemci de aynı gövdeyi kurar (ağda gövde gönderimine gerek kalmaz).
 * Bu yüzden burada motorlar arasında farklı sonuç verebilen Math.hypot yerine sqrt kullanılır.
 */
export class Body {
  private xs: Float32Array;
  private ys: Float32Array;
  private mask: number;
  private newest = -1;
  private n = 0;

  constructor(
    readonly spacing: number,
    initialCapacity = 64,
  ) {
    let cap = 16;
    while (cap < initialCapacity) cap *= 2;
    this.xs = new Float32Array(cap);
    this.ys = new Float32Array(cap);
    this.mask = cap - 1;
  }

  get count(): number {
    return this.n;
  }

  x(i: number): number {
    return this.xs[(this.newest - i) & this.mask]!;
  }

  y(i: number): number {
    return this.ys[(this.newest - i) & this.mask]!;
  }

  clear(): void {
    this.n = 0;
    this.newest = -1;
  }

  push(x: number, y: number): void {
    if (this.n > this.mask) this.grow();
    this.newest = (this.newest + 1) & this.mask;
    this.xs[this.newest] = x;
    this.ys[this.newest] = y;
    this.n++;
  }

  /** Kafanın arkasına düz bir çizgi halinde `length` uzunluğunda gövde kurar. */
  reset(hx: number, hy: number, angle: number, length: number): void {
    this.clear();
    const k = Math.max(1, Math.ceil(length / this.spacing));
    const dx = Math.cos(angle) * this.spacing;
    const dy = Math.sin(angle) * this.spacing;
    for (let j = k; j >= 1; j--) this.push(hx - dx * j, hy - dy * j);
  }

  /** Kafa (hx, hy)'ye ilerledi: son noktadan itibaren sabit aralıkla yeni noktalar ekler. */
  advance(hx: number, hy: number): void {
    if (this.n === 0) {
      this.push(hx, hy);
      return;
    }
    let lx = this.x(0);
    let ly = this.y(0);
    const dx = hx - lx;
    const dy = hy - ly;
    let d = Math.sqrt(dx * dx + dy * dy);
    const s = this.spacing;
    if (d < s) return;
    const ux = (dx / d) * s;
    const uy = (dy / d) * s;
    while (d >= s) {
      lx += ux;
      ly += uy;
      this.push(lx, ly);
      d -= s;
    }
  }

  /** Kafa ile en yeni nokta arasındaki mesafe. */
  headGap(hx: number, hy: number): number {
    if (this.n === 0) return 0;
    const dx = hx - this.x(0);
    const dy = hy - this.y(0);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Kafadan ölçülen yol uzunluğu en az `keepLen` kalacak şekilde kuyruktan fazlasını siler. */
  trim(hx: number, hy: number, keepLen: number): void {
    const d0 = this.headGap(hx, hy);
    const need = d0 >= keepLen ? 1 : Math.ceil((keepLen - d0) / this.spacing) + 1;
    if (this.n > need) this.n = need;
  }

  /** Kafadan `arc` uzaklıktaki yol noktası (kuyruğu geçerse kuyruk). */
  pointAt(hx: number, hy: number, arc: number, out: { x: number; y: number }): void {
    if (this.n === 0) {
      out.x = hx;
      out.y = hy;
      return;
    }
    const d0 = this.headGap(hx, hy);
    if (arc <= d0) {
      const t = d0 > 0 ? arc / d0 : 0;
      out.x = hx + (this.x(0) - hx) * t;
      out.y = hy + (this.y(0) - hy) * t;
      return;
    }
    const f = (arc - d0) / this.spacing;
    const i = Math.floor(f);
    if (i >= this.n - 1) {
      out.x = this.x(this.n - 1);
      out.y = this.y(this.n - 1);
      return;
    }
    const t = f - i;
    out.x = this.x(i) + (this.x(i + 1) - this.x(i)) * t;
    out.y = this.y(i) + (this.y(i + 1) - this.y(i)) * t;
  }

  private grow(): void {
    const cap = (this.mask + 1) * 2;
    const nx = new Float32Array(cap);
    const ny = new Float32Array(cap);
    // en eski nokta 0. indekse, en yeni n-1'e
    for (let i = 0; i < this.n; i++) {
      nx[i] = this.x(this.n - 1 - i);
      ny[i] = this.y(this.n - 1 - i);
    }
    this.xs = nx;
    this.ys = ny;
    this.mask = cap - 1;
    this.newest = this.n - 1;
  }
}
