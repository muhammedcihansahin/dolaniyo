import type { RoomErrorCode } from '@yilan/shared';

/** Bağlantı/oda hataları: kurucunun gönderdiği kodlar + istemcinin kendi durumları. */
export type NetErrorCode =
  | RoomErrorCode
  | 'unreachable'
  /** Oda bulundu, kurucu yanıt verdi ama iki tarayıcı arasında bağlantı kurulamadı (ağ engeli). */
  | 'p2pFailed'
  /** Oda kayıtlı ama kurucunun tarayıcısı yanıt vermedi (sekme/uygulama uyuyor ya da kapanmak üzere). */
  | 'noAnswer'
  | 'closed'
  | 'noWebrtc';

export class NetError extends Error {
  /** `params`: hata metnindeki yer tutucular (ör. bağlantı ayrıntısı). */
  constructor(
    readonly code: NetErrorCode,
    readonly params?: Record<string, string>,
  ) {
    super(code);
  }
}
