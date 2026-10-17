/**
 * Gövde örnek noktaları için uzamsal ızgara. Her tick baştan kurulur (sayarak sıralama),
 * böylece sorgular yalnızca çevredeki hücrelere bakar.
 */
export class BodyGrid {
  readonly cols: number;
  private readonly origin: number;
  private readonly cellStart: Int32Array;
  private readonly cellFill: Int32Array;

  count = 0;
  sx = new Float32Array(0);
  sy = new Float32Array(0);
  sr = new Float32Array(0);
  /** Kafadan itibaren yol uzaklığı (kafa = 0). */
  sArc = new Float32Array(0);
  sOwner = new Int32Array(0);
  /** Izgaradaki en büyük örnek yarıçapı (sorgu payı için; yılan boyu sınırsız). */
  maxRadius = 0;

  private tx = new Float32Array(0);
  private ty = new Float32Array(0);
  private tr = new Float32Array(0);
  private tArc = new Float32Array(0);
  private tOwner = new Int32Array(0);
  private tCell = new Int32Array(0);
  private tn = 0;

  private hitBuf = new Int32Array(256);

  constructor(
    arenaRadius: number,
    readonly cellSize = 128,
  ) {
    this.origin = -arenaRadius - cellSize * 2;
    this.cols = Math.ceil((arenaRadius * 2 + cellSize * 4) / cellSize);
    this.cellStart = new Int32Array(this.cols * this.cols + 1);
    this.cellFill = new Int32Array(this.cols * this.cols);
    this.ensureCapacity(1024);
  }

  /** Son `query` sonuçları (ilk `n` eleman geçerli). */
  get hits(): Int32Array {
    return this.hitBuf;
  }

  beginBuild(): void {
    this.tn = 0;
    this.maxRadius = 0;
  }

  addSample(x: number, y: number, r: number, arc: number, owner: number): void {
    if (this.tn >= this.tx.length) this.ensureCapacity(this.tx.length * 2);
    const i = this.tn++;
    this.tx[i] = x;
    this.ty[i] = y;
    this.tr[i] = r;
    this.tArc[i] = arc;
    this.tOwner[i] = owner;
    this.tCell[i] = this.cellIndex(x, y);
    if (r > this.maxRadius) this.maxRadius = r;
  }

  endBuild(): void {
    const n = this.tn;
    const start = this.cellStart;
    const fill = this.cellFill;
    start.fill(0);
    for (let i = 0; i < n; i++) start[this.tCell[i]! + 1]!++;
    for (let c = 1; c < start.length; c++) start[c]! += start[c - 1]!;
    fill.set(start.subarray(0, fill.length));
    for (let i = 0; i < n; i++) {
      const j = fill[this.tCell[i]!]!++;
      this.sx[j] = this.tx[i]!;
      this.sy[j] = this.ty[i]!;
      this.sr[j] = this.tr[i]!;
      this.sArc[j] = this.tArc[i]!;
      this.sOwner[j] = this.tOwner[i]!;
    }
    this.count = n;
  }

  /** (x, y) etrafında `radius` kutusuna değen hücrelerdeki örnekleri `hits`e yazar, sayısını döner. */
  query(x: number, y: number, radius: number): number {
    const cs = this.cellSize;
    const c0 = this.clampCol(Math.floor((x - radius - this.origin) / cs));
    const c1 = this.clampCol(Math.floor((x + radius - this.origin) / cs));
    const r0 = this.clampCol(Math.floor((y - radius - this.origin) / cs));
    const r1 = this.clampCol(Math.floor((y + radius - this.origin) / cs));
    let n = 0;
    for (let r = r0; r <= r1; r++) {
      const row = r * this.cols;
      for (let c = c0; c <= c1; c++) {
        const a = this.cellStart[row + c]!;
        const b = this.cellStart[row + c + 1]!;
        if (n + (b - a) > this.hitBuf.length) {
          const bigger = new Int32Array(Math.max(this.hitBuf.length * 2, n + (b - a)));
          bigger.set(this.hitBuf);
          this.hitBuf = bigger;
        }
        for (let k = a; k < b; k++) this.hitBuf[n++] = k;
      }
    }
    return n;
  }

  private cellIndex(x: number, y: number): number {
    const c = this.clampCol(Math.floor((x - this.origin) / this.cellSize));
    const r = this.clampCol(Math.floor((y - this.origin) / this.cellSize));
    return r * this.cols + c;
  }

  private clampCol(v: number): number {
    return v < 0 ? 0 : v >= this.cols ? this.cols - 1 : v;
  }

  private ensureCapacity(cap: number): void {
    const grow = <T extends Float32Array | Int32Array>(a: T, make: (n: number) => T): T => {
      const b = make(cap);
      b.set(a.subarray(0, Math.min(a.length, cap)));
      return b;
    };
    this.tx = grow(this.tx, (n) => new Float32Array(n));
    this.ty = grow(this.ty, (n) => new Float32Array(n));
    this.tr = grow(this.tr, (n) => new Float32Array(n));
    this.tArc = grow(this.tArc, (n) => new Float32Array(n));
    this.tOwner = grow(this.tOwner, (n) => new Int32Array(n));
    this.tCell = grow(this.tCell, (n) => new Int32Array(n));
    this.sx = new Float32Array(cap);
    this.sy = new Float32Array(cap);
    this.sr = new Float32Array(cap);
    this.sArc = new Float32Array(cap);
    this.sOwner = new Int32Array(cap);
  }
}
