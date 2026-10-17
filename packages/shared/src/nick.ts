export const NICK_MAX_CHARS = 16;
export const ROOM_MAX_CHARS = 20;

const CONTROL = /\p{Cc}/gu;
const INVISIBLE = /[­​-‏‪-‮⁠-⁯﻿]/g;
/** Üst üste 2'den fazla birleşik işaret (zalgo yazısı) kırpılır. */
const ZALGO = /(\p{M}{2})\p{M}+/gu;
const ROOM_RE = /^[A-Za-z0-9_-]{1,20}$/;

/** Takma adı temizler; boş kalırsa null döner. */
export function sanitizeNick(raw: string): string | null {
  const cleaned = raw
    .replace(CONTROL, '')
    .replace(INVISIBLE, '')
    .replace(ZALGO, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(cleaned).slice(0, NICK_MAX_CHARS).join('').trim();
  return chars.length > 0 ? chars : null;
}

export function guestName(rand: () => number): string {
  return `Guest${100 + Math.floor(rand() * 900)}`;
}

export interface ParsedNick {
  nick: string | null;
  /** Küçük harfe çevrilmiş oda adı; geçersiz veya yoksa null. */
  room: string | null;
}

/** "Ad@Oda" biçimindeki girişi ayrıştırır. */
export function parseNickInput(input: string): ParsedNick {
  const at = input.lastIndexOf('@');
  if (at < 0) return { nick: sanitizeNick(input), room: null };
  const roomRaw = input.slice(at + 1).trim();
  return {
    nick: sanitizeNick(input.slice(0, at)),
    room: ROOM_RE.test(roomRaw) ? roomRaw.toLowerCase() : null,
  };
}
