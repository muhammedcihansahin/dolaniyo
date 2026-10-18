/** Büyüyebilen ikili yazıcı (little-endian). Tekrar kullanılır: `reset()` → yaz → `finish()`. */
export class BinaryWriter {
  private bytes: Uint8Array<ArrayBuffer>;
  private view: DataView;
  pos = 0;

  constructor(initialSize = 1024) {
    this.bytes = new Uint8Array(initialSize);
    this.view = new DataView(this.bytes.buffer);
  }

  reset(): this {
    this.pos = 0;
    return this;
  }

  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
  }

  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.pos, v, true);
    this.pos += 4;
  }

  i32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.pos, v, true);
    this.pos += 4;
  }

  f32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
  }

  /** Kısa metin: UTF-16 birim sayısı (u8, en fazla 255) + birimler (u16). */
  str(s: string): void {
    const n = Math.min(s.length, 255);
    this.u8(n);
    this.ensure(n * 2);
    for (let i = 0; i < n; i++) {
      this.view.setUint16(this.pos, s.charCodeAt(i), true);
      this.pos += 2;
    }
  }

  /** Sayısı sonradan bilinecek bir u32 için yer ayırır; `patchU32` ile doldurulur. */
  reserveU32(): number {
    const at = this.pos;
    this.u32(0);
    return at;
  }

  patchU32(at: number, v: number): void {
    this.view.setUint32(at, v, true);
  }

  /** Yazılanların kopyası (yazıcı yeniden kullanılabilir). */
  finish(): Uint8Array<ArrayBuffer> {
    return this.bytes.slice(0, this.pos);
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, this.pos));
    this.bytes = next;
    this.view = new DataView(next.buffer);
  }
}

/** Sınır denetimli ikili okuyucu; mesaj kısa kesilmişse `RangeError` fırlatır. */
export class BinaryReader {
  private readonly view: DataView;
  pos = 0;

  constructor(data: ArrayBuffer | Uint8Array) {
    this.view =
      data instanceof Uint8Array
        ? new DataView(data.buffer, data.byteOffset, data.byteLength)
        : new DataView(data);
  }

  get remaining(): number {
    return this.view.byteLength - this.pos;
  }

  u8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f32(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  str(): string {
    const n = this.u8();
    const units = new Array<number>(n);
    for (let i = 0; i < n; i++) units[i] = this.u16();
    return String.fromCharCode(...units);
  }
}
