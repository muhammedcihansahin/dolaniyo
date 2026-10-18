import type { RoomErrorCode } from '@yilan/shared';

/** Bağlantı/oda hataları: kurucunun gönderdiği kodlar + istemcinin kendi durumları. */
export type NetErrorCode = RoomErrorCode | 'unreachable' | 'closed' | 'noWebrtc';

export class NetError extends Error {
  constructor(readonly code: NetErrorCode) {
    super(code);
  }
}
