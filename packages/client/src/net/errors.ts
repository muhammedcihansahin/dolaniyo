import type { RoomErrorCode } from '@yilan/shared';

/** Bağlantı/oda hataları: kurucunun gönderdiği kodlar + istemcinin kendi durumları. */
export type NetErrorCode =
  | RoomErrorCode
  | 'unreachable'
  /** Oda bulundu ama iki tarayıcı arasında bağlantı kurulamadı (ağ engeli). */
  | 'p2pFailed'
  | 'closed'
  | 'noWebrtc';

export class NetError extends Error {
  constructor(readonly code: NetErrorCode) {
    super(code);
  }
}
