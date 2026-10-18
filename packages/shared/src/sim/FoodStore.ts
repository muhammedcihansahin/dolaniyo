import { foodRadius } from '../config';

export const FoodKind = {
  Ambient: 0,
  Boost: 1,
  Death: 2,
} as const;
export type FoodKind = (typeof FoodKind)[keyof typeof FoodKind];

/**
 * Yem havuzu: yapı-dizileri (SoA) düzeninde, sabit slotlar + serbest liste.
 * Konuma göre sorgu için kendi ızgarasını tutar (yem ekle/sil/taşı ile güncellenir).
 */
export class FoodStore {
  capacity = 0;
  /** Kullanılmış en yüksek slot + 1 (döngüler için üst sınır). */
  highWater = 0;
  aliveCount = 0;
  ambientCount = 0;
  /** Şimdiye kadar eklenen en büyük yem yarıçapı (sorgu payı için). */
  maxRadius = 0;
  /** Simülasyonun şu anki tick'i (World her adımda günceller); doğma/taşınma damgası için. */
  tick = 0;

  x = new Float32Array(0);
  y = new Float32Array(0);
  value = new Float32Array(0);
  radius = new Float32Array(0);
  color = new Uint8Array(0);
  kind = new Uint8Array(0);
  alive = new Uint8Array(0);
  /** Söneceği tick; -1 = sonsuz. */
  expire = new Int32Array(0);
  /** Eklendiği tick (çizimde belirme animasyonu için). */
  born = new Int32Array(0);
  /** Son taşındığı tick ve o tick başındaki konumu — çizimde interpolasyon için. */
  movedAt = new Int32Array(0);
  px = new Float32Array(0);
  py = new Float32Array(0);
  id = new Uint32Array(0);

  /**
   * Sunucu: istemcilere gönderilecek değişikliklerin kaydı. Açıkken aşağıdaki dizilere yazılır,
   * okuyan (oda yayını) `clearChanges()` ile boşaltır.
   */
  trackChanges = false;
  /** Eklenenler: [id, x, y, yarıçap, renk, tür, söneceği tick] × n */
  readonly addLog: number[] = [];
  /** Silinenler: [id, yiyen yılan id (0 = süresi doldu)] × n */
  readonly removeLog: number[] = [];
  /** Bu tick taşınan slotlar (tick başına ilk taşınmada bir kez). */
  readonly moveLog: number[] = [];
  /** Söneceği tick'i sonradan değişenler: [id, yeni tick (-1 = sonsuz)] × n */
  readonly expireLog: number[] = [];
  /** Ortam dışı (boost/ölüm) canlı yem sayısı. */
  get looseCount(): number {
    return this.aliveCount - this.ambientCount;
  }

  private cellOf = new Int32Array(0);
  private idxInCell = new Int32Array(0);
  private free: number[] = [];
  private nextId = 1;

  private readonly cells: number[][];
  private readonly cols: number;
  private readonly origin: number;

  constructor(
    arenaRadius: number,
    readonly cellSize = 128,
    initialCapacity = 1024,
  ) {
    this.origin = -arenaRadius - cellSize;
    this.cols = Math.ceil((arenaRadius * 2 + cellSize * 2) / cellSize);
    this.cells = Array.from({ length: this.cols * this.cols }, () => []);
    this.grow(initialCapacity);
  }

  add(
    x: number,
    y: number,
    value: number,
    color: number,
    kind: FoodKind,
    expireTick = -1,
    radius = foodRadius(value),
    /** Verilmezse yeni id üretilir (istemci aynası sunucunun id'sini verir). */
    id = this.nextId++,
  ): number {
    let slot = this.free.pop();
    if (slot === undefined) {
      if (this.highWater >= this.capacity) this.grow(this.capacity * 2);
      slot = this.highWater++;
    }
    this.x[slot] = x;
    this.y[slot] = y;
    this.value[slot] = value;
    this.radius[slot] = radius;
    if (radius > this.maxRadius) this.maxRadius = radius;
    this.color[slot] = color;
    this.kind[slot] = kind;
    this.alive[slot] = 1;
    this.expire[slot] = expireTick;
    this.born[slot] = this.tick;
    this.movedAt[slot] = -1;
    this.id[slot] = id;
    this.aliveCount++;
    if (kind === FoodKind.Ambient) this.ambientCount++;
    this.insertCell(slot, this.cellIndex(x, y));
    if (this.trackChanges) {
      this.addLog.push(
        id,
        this.x[slot]!,
        this.y[slot]!,
        this.radius[slot]!,
        color,
        kind,
        expireTick,
      );
    }
    return slot;
  }

  /** `eaterId`: yiyen yılan (0 = süresi doldu); yalnızca değişiklik kaydı için. */
  remove(slot: number, eaterId = 0): void {
    if (!this.alive[slot]) return;
    if (this.trackChanges) this.removeLog.push(this.id[slot]!, eaterId);
    this.alive[slot] = 0;
    this.aliveCount--;
    if (this.kind[slot] === FoodKind.Ambient) this.ambientCount--;
    this.removeCell(slot);
    this.free.push(slot);
  }

  move(slot: number, x: number, y: number): void {
    if (this.movedAt[slot] !== this.tick) {
      this.movedAt[slot] = this.tick;
      this.px[slot] = this.x[slot]!;
      this.py[slot] = this.y[slot]!;
      if (this.trackChanges) this.moveLog.push(slot);
    }
    this.x[slot] = x;
    this.y[slot] = y;
    const c = this.cellIndex(x, y);
    if (c !== this.cellOf[slot]) {
      this.removeCell(slot);
      this.insertCell(slot, c);
    }
  }

  /** Yemin söneceği tick'i değiştirir (-1 = hiç sönmez); değişiklik kaydına yazılır. */
  setExpire(slot: number, expireTick: number): void {
    if (!this.alive[slot] || this.expire[slot] === expireTick) return;
    this.expire[slot] = expireTick;
    if (this.trackChanges) this.expireLog.push(this.id[slot]!, expireTick);
  }

  clearChanges(): void {
    this.addLog.length = 0;
    this.removeLog.length = 0;
    this.moveLog.length = 0;
    this.expireLog.length = 0;
  }

  /** Yemin bu tick başındaki konumu (bu tick taşındıysa eski yeri). */
  startX(slot: number): number {
    return this.movedAt[slot] === this.tick ? this.px[slot]! : this.x[slot]!;
  }

  startY(slot: number): number {
    return this.movedAt[slot] === this.tick ? this.py[slot]! : this.y[slot]!;
  }

  /** Dikdörtgene değen hücrelerdeki yem slotlarını `out`a yazar (kesin filtre çağırana ait). */
  queryRect(minX: number, minY: number, maxX: number, maxY: number, out: number[]): number {
    out.length = 0;
    const cs = this.cellSize;
    const c0 = this.clampCol(Math.floor((minX - this.origin) / cs));
    const c1 = this.clampCol(Math.floor((maxX - this.origin) / cs));
    const r0 = this.clampCol(Math.floor((minY - this.origin) / cs));
    const r1 = this.clampCol(Math.floor((maxY - this.origin) / cs));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = this.cells[r * this.cols + c]!;
        for (let k = 0; k < cell.length; k++) out.push(cell[k]!);
      }
    }
    return out.length;
  }

  query(x: number, y: number, radius: number, out: number[]): number {
    return this.queryRect(x - radius, y - radius, x + radius, y + radius, out);
  }

  private cellIndex(x: number, y: number): number {
    const c = this.clampCol(Math.floor((x - this.origin) / this.cellSize));
    const r = this.clampCol(Math.floor((y - this.origin) / this.cellSize));
    return r * this.cols + c;
  }

  private clampCol(v: number): number {
    return v < 0 ? 0 : v >= this.cols ? this.cols - 1 : v;
  }

  private insertCell(slot: number, c: number): void {
    const cell = this.cells[c]!;
    this.cellOf[slot] = c;
    this.idxInCell[slot] = cell.length;
    cell.push(slot);
  }

  private removeCell(slot: number): void {
    const cell = this.cells[this.cellOf[slot]!]!;
    const i = this.idxInCell[slot]!;
    const last = cell.pop()!;
    if (last !== slot) {
      cell[i] = last;
      this.idxInCell[last] = i;
    }
  }

  private grow(cap: number): void {
    const copy = <T extends Float32Array | Uint8Array | Int32Array | Uint32Array>(
      a: T,
      make: (n: number) => T,
    ): T => {
      const b = make(cap);
      b.set(a);
      return b;
    };
    this.x = copy(this.x, (n) => new Float32Array(n));
    this.y = copy(this.y, (n) => new Float32Array(n));
    this.value = copy(this.value, (n) => new Float32Array(n));
    this.radius = copy(this.radius, (n) => new Float32Array(n));
    this.color = copy(this.color, (n) => new Uint8Array(n));
    this.kind = copy(this.kind, (n) => new Uint8Array(n));
    this.alive = copy(this.alive, (n) => new Uint8Array(n));
    this.expire = copy(this.expire, (n) => new Int32Array(n));
    this.born = copy(this.born, (n) => new Int32Array(n));
    this.movedAt = copy(this.movedAt, (n) => new Int32Array(n));
    this.px = copy(this.px, (n) => new Float32Array(n));
    this.py = copy(this.py, (n) => new Float32Array(n));
    this.id = copy(this.id, (n) => new Uint32Array(n));
    this.cellOf = copy(this.cellOf, (n) => new Int32Array(n));
    this.idxInCell = copy(this.idxInCell, (n) => new Int32Array(n));
    this.capacity = cap;
  }
}
