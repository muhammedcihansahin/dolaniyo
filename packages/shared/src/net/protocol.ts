import type { SimConfig, SpeedChange } from '../config';
import { TAU, normalizeAngle } from '../math';
import type { DeathReason } from '../sim/World';
import { BinaryReader, BinaryWriter } from './binary';

/**
 * Oda protokolü. Odayı kuranın tarayıcısı sunucudur (RoomHost); diğerleri ona WebRTC veri
 * kanalıyla bağlanır, kurucunun kendisi aynı sayfadan. Odaya katılmak kanalı açmaktır.
 * - Kontrol mesajları (doğ, ayrıl, hata) JSON metin olarak gider.
 * - Sık mesajlar ikilidir: istemci → kurucu `INPUT`, kurucu → istemci `INIT` (katılınca tüm
 *   durum) ve her tick `TICK` (yalnızca değişiklikler). Ayrıntı: WorldEncoder / WorldMirror.
 * - Büyük ikili mesajlar (INIT) veri kanalı sınırına takılmasın diye `CHUNK` parçalarıyla gider.
 */
export const PROTOCOL_VERSION = 5;

/** İkili mesajların ilk baytı. */
export const BinMsg = {
  /** İstemci → sunucu: yön + boost. */
  Input: 1,
  /** Sunucu → istemci: odanın tüm durumu (katılınca bir kez). */
  Init: 2,
  /** Sunucu → istemci: bir tick'in değişiklikleri. */
  Tick: 3,
  /** Büyük bir mesajın parçası: [4][son parça mı (0/1)][veri…]. */
  Chunk: 4,
} as const;

export const MAX_ROOM_PLAYERS = 16;

export type ClientMessage =
  /** Odada yılanla oyuna gir (izleyiciyken). */
  | { t: 'spawn'; name: string; color: number }
  /** Yılanı bırakıp menüye dön; bağlantı ve oda üyeliği sürer. */
  | { t: 'leave' }
  /**
   * Sekme arka plana geçti / öne geldi. Odadaki tek kişi arka plandaysa oda duraklar
   * (botlu tek kişilik oyun gibi); başka biri varsa oyun akmaya devam eder.
   */
  | { t: 'away'; away: boolean }
  /**
   * Oyun hızını değiştir (H/Y/R tuşları). Yalnızca odayı kuran ya da odada kendisinden başka
   * gerçek oyuncu yılanı olmayan kişi değiştirebilir; aksi halde `speedDenied` döner.
   */
  | { t: 'speed'; change: SpeedChange }
  /** Oyun hızını doğrudan ayarla (odayı kuranın menüdeki sürgüsü); yetki kuralı aynı. */
  | { t: 'speed'; set: number };

export type RoomErrorCode = 'notFound' | 'full' | 'badRequest' | 'version';

export type ServerMessage =
  | {
      t: 'joined';
      code: string;
      bots: number;
      maxPlayers: number;
      /** İstemci aynası birebir aynı kurallarla gövde kursun diye odanın ayarları. */
      cfg: SimConfig;
      /** Kurucunun yerel ağ adresleri (oyun yerelden açıldıysa; paylaşım bağlantısı için). */
      lan: string[];
    }
  | { t: 'spawned'; id: number }
  /** Odaya bağlı kişi sayısı (menüdekiler dahil) değişti. */
  | { t: 'people'; count: number }
  /** Odanın oyun hızı değişti (herkese gider). */
  | { t: 'speed'; speed: number }
  | { t: 'speedDenied' }
  | { t: 'error'; code: RoomErrorCode };

/** Veri kanalının tüm tarayıcılarda güvenle taşıdığı mesaj boyu (bayt). */
export const MAX_CHUNK_BYTES = 16 * 1024;

/** Büyük ikili mesajı `Chunk` parçalarına böler; küçükse olduğu gibi döner. */
export function splitMessage(data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>[] {
  if (data.byteLength <= MAX_CHUNK_BYTES) return [data];
  const size = MAX_CHUNK_BYTES - 2;
  const out: Uint8Array<ArrayBuffer>[] = [];
  for (let at = 0; at < data.byteLength; at += size) {
    const part = data.subarray(at, at + size);
    const chunk = new Uint8Array(part.byteLength + 2);
    chunk[0] = BinMsg.Chunk;
    chunk[1] = at + size >= data.byteLength ? 1 : 0;
    chunk.set(part, 2);
    out.push(chunk);
  }
  return out;
}

/** `splitMessage` parçalarını birleştirir. Parça olmayan mesajı olduğu gibi döndürür. */
export class ChunkAssembler {
  private parts: Uint8Array[] = [];
  private size = 0;

  /** Mesaj tamamlandıysa onu, parçalar daha bitmediyse null döner. */
  push(data: ArrayBuffer): ArrayBuffer | null {
    const bytes = new Uint8Array(data);
    if (bytes[0] !== BinMsg.Chunk) return data;
    const part = bytes.subarray(2);
    this.parts.push(part);
    this.size += part.byteLength;
    if (bytes[1] !== 1) return null;
    const whole = new Uint8Array(this.size);
    let at = 0;
    for (const p of this.parts) {
      whole.set(p, at);
      at += p.byteLength;
    }
    this.parts = [];
    this.size = 0;
    return whole.buffer;
  }
}

/** Oda kodu alfabesi: karışan karakterler (0/O, 1/I) yok. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function makeRoomCode(rand: () => number): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Yazılan kodu büyük harfe çevirip boşlukları atar; geçersizse null. */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(code) ? code : null;
}

export const DEATH_REASONS: readonly DeathReason[] = ['border', 'body', 'head', 'left'];

/** Açı → u16 (yaklaşık 0.0001 rad çözünürlük). */
export function packAngle(a: number): number {
  return Math.round(((normalizeAngle(a) + Math.PI) / TAU) * 65536) & 0xffff;
}

export function unpackAngle(q: number): number {
  return (q / 65536) * TAU - Math.PI;
}

const inputWriter = new BinaryWriter(8);

export function encodeInput(angle: number, boost: boolean): Uint8Array<ArrayBuffer> {
  const w = inputWriter.reset();
  w.u8(BinMsg.Input);
  w.u16(packAngle(angle));
  w.u8(boost ? 1 : 0);
  return w.finish();
}

export function decodeInput(data: Uint8Array): { angle: number; boost: boolean } | null {
  if (data.byteLength !== 4 || data[0] !== BinMsg.Input) return null;
  const r = new BinaryReader(data);
  r.u8();
  return { angle: unpackAngle(r.u16()), boost: (r.u8() & 1) === 1 };
}

/** İkili mesajın türü (ilk bayt); boşsa -1. */
export function binaryType(data: ArrayBuffer | Uint8Array): number {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return bytes.byteLength > 0 ? bytes[0]! : -1;
}
