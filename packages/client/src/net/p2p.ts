import {
  ChunkAssembler,
  PROTOCOL_VERSION,
  RoomHost,
  makeRoomCode,
  splitMessage,
  type RoomLink,
  type RoomMember,
  type RoomTicker,
  type ServerMessage,
} from '@yilan/shared';
import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import { NetError } from './errors';

/**
 * Odalar sunucusuz çalışır: odayı kuranın tarayıcısı odanın sunucusudur (RoomHost). Oda kodu
 * PeerJS'in ücretsiz eşleştirme sunucusunda kurucunun kimliği olur (`yilan-K7QXP`); katılan
 * bu kimliğe bağlanır, sonra tüm oyun verisi iki tarayıcı arasında doğrudan (WebRTC) akar.
 * Hiçbir yerde oda kaydı tutulmaz; kurucu ayrılınca oda biter.
 */
const PEER_PREFIX = 'yilan-io-';
const ARENA_RADIUS = 20000;
/** Eşleştirme sunucusuna kaydolma süresi sınırı. */
const CONNECT_TIMEOUT_MS = 15_000;
/** Kurucunun tarayıcısına doğrudan/aktarıcı üzerinden bağlanma süresi sınırı. */
const DIAL_TIMEOUT_MS = 25_000;
/** Bağlandıktan sonra eşleştirme sunucusundan ayrılmadan önce geç gelen ağ adaylarını bekle. */
const SIGNAL_LINGER_MS = 10_000;
/** Kurucudan bu süre veri gelmezse (her tick gelmeli) bağlantı kopmuş sayılır. */
const SILENCE_TIMEOUT_MS = 8000;
/** Sayfa yenilenince eski kimlik eşleştirme sunucusunda kısa süre dolu kalabilir. */
const REHOST_RETRIES = 4;
const REHOST_RETRY_MS = 1500;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** NetGame'in konuştuğu kanal: kurucuya (ya da kurucuysak kendi odamıza) bağlı. */
export interface ClientLink {
  send(data: string | Uint8Array<ArrayBuffer>): void;
  readonly open: boolean;
  onmessage: ((data: string | ArrayBuffer) => void) | null;
  onclose: (() => void) | null;
  close(): void;
}

/**
 * Bağlantı yolu bulma (ICE) sunucuları. STUN, iki tarayıcının doğrudan bağlanması için dış
 * adreslerini öğrenmesini sağlar; çoğu ev ağında bu yeter. Mobil veri, okul/iş ağı gibi
 * katı NAT'lerde doğrudan bağlantı kurulamaz, veri bir TURN aktarıcısı üzerinden gider:
 * birkaç ücretsiz aktarıcı sırayla denenir (biri çalışmıyorsa diğeri). Kendi aktarıcınızı
 * derlemede `VITE_ICE_SERVERS` (RTCIceServer[] JSON) ile ekleyebilirsiniz.
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  {
    urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'],
    username: 'peerjs',
    credential: 'peerjsp',
  },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

function iceServers(): RTCIceServer[] {
  const extra = import.meta.env.VITE_ICE_SERVERS as string | undefined;
  if (!extra) return ICE_SERVERS;
  try {
    const list = JSON.parse(extra) as RTCIceServer[];
    return Array.isArray(list) ? [...list, ...ICE_SERVERS] : ICE_SERVERS;
  } catch {
    return ICE_SERVERS;
  }
}

/**
 * PeerJS seçenekleri. Eşleştirme sunucusu varsayılan olarak PeerJS'in ücretsiz bulut sunucusu;
 * `VITE_PEER_SERVER=host:port/yol` ile kendi PeerJS sunucunuz kullanılabilir (yerel deneme).
 */
function peerOptions(): PeerOptions {
  const opts: PeerOptions = { debug: 0, config: { iceServers: iceServers() } };
  const server = import.meta.env.VITE_PEER_SERVER as string | undefined;
  if (server) {
    const m = /^(?:(wss?|https?):\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(server);
    if (m) {
      opts.secure = m[1] === 'https' || m[1] === 'wss';
      opts.host = m[2]!;
      opts.port = m[3] ? Number(m[3]) : opts.secure ? 443 : 80;
      opts.path = m[4] ?? '/';
    }
  }
  return opts;
}

function peerId(code: string): string {
  return PEER_PREFIX + code;
}

/**
 * Oda saatini bir Worker'dan besler: arka plandaki sekmede ana sayfanın zamanlayıcıları
 * saniyede bire düşer, Worker'ınkiler düşmez — kurucu başka sekmeye geçse de oda akar.
 */
class WorkerTicker implements RoomTicker {
  private worker: Worker | null = null;
  private fallback = 0;

  start(fn: () => void): void {
    this.stop();
    try {
      const src = 'setInterval(() => postMessage(0), 8);';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
      this.worker.onmessage = fn;
    } catch {
      this.fallback = window.setInterval(fn, 8);
    }
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    window.clearInterval(this.fallback);
    this.fallback = 0;
  }
}

/** Kurucunun kendi oyunu ile odası arasındaki kanal çifti (aynı sayfada, sırası korunur). */
function loopback(host: RoomHost): ClientLink {
  let member: RoomMember | null = null;
  let open = true;
  const client: ClientLink = {
    onmessage: null,
    onclose: null,
    get open() {
      return open;
    },
    send(data) {
      if (!open || !member) return;
      const m = member;
      queueMicrotask(() => host.receive(m, data));
    },
    close() {
      if (!open) return;
      open = false;
      host.close();
    },
  };
  const toClient: RoomLink = {
    buffered: 0,
    send(data) {
      if (!open) return;
      // INIT/TICK her seferinde yeni bir kopya (BinaryWriter.finish); tamponu tam boy
      const msg = typeof data === 'string' ? data : data.buffer;
      queueMicrotask(() => client.onmessage?.(msg));
    },
    close() {
      if (!open) return;
      open = false;
      queueMicrotask(() => client.onclose?.());
    },
  };
  // NetGame dinleyicisini kurduktan sonra katıl
  queueMicrotask(() => (member = host.add(toClient, true)));
  return client;
}

/** Bir arkadaşın veri kanalını odaya bağlar. */
function admit(host: RoomHost, conn: DataConnection): void {
  const meta = conn.metadata as { v?: unknown } | undefined;
  const link: RoomLink = {
    get buffered() {
      // PeerJS kanal doluyken kendi kuyruğunda da tutar (BufferedConnection.bufferSize)
      const queued = (conn as { bufferSize?: number }).bufferSize ?? 0;
      return (conn.dataChannel?.bufferedAmount ?? 0) + queued;
    },
    send(data) {
      if (!conn.open) return;
      if (typeof data === 'string') conn.send(data);
      else for (const part of splitMessage(data)) conn.send(part);
    },
    close() {
      conn.close();
    },
  };
  let member: RoomMember | null = null;
  conn.on('open', () => {
    if (meta?.v !== PROTOCOL_VERSION) {
      link.send(JSON.stringify({ t: 'error', code: 'version' } satisfies ServerMessage));
      window.setTimeout(() => conn.close(), 500);
      return;
    }
    member = host.add(link);
  });
  conn.on('data', (data) => {
    if (!member) return;
    if (typeof data === 'string') host.receive(member, data);
    else if (data instanceof ArrayBuffer && data.byteLength <= 64) {
      host.receive(member, new Uint8Array(data));
    }
  });
  const drop = () => {
    if (member) host.remove(member);
    member = null;
  };
  conn.on('close', drop);
  conn.on('error', () => {
    drop();
    conn.close();
  });
}

/** Paylaşım bağlantısı için: oyun yerel sunucudan açıldıysa onun yerel ağ adresleri. */
async function localAddresses(): Promise<string[]> {
  if (!LOCAL_HOSTS.has(location.hostname)) return [];
  try {
    const res = await fetch('/api/lan');
    const body = (await res.json()) as { lan?: unknown };
    return Array.isArray(body.lan) ? body.lan.filter((a) => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

/** Eşleştirme sunucusuna `id` kimliğiyle kaydolur. Kimlik doluysa `taken` döner. */
function register(id: string): Promise<Peer | 'taken'> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(id, peerOptions());
    const timer = window.setTimeout(() => {
      peer.destroy();
      reject(new NetError('unreachable'));
    }, CONNECT_TIMEOUT_MS);
    peer.once('open', () => {
      window.clearTimeout(timer);
      resolve(peer);
    });
    peer.once('error', (err) => {
      window.clearTimeout(timer);
      peer.destroy();
      if (err.type === 'unavailable-id') resolve('taken');
      else if (err.type === 'browser-incompatible') reject(new NetError('noWebrtc'));
      else reject(new NetError('unreachable'));
    });
  });
}

/**
 * Bu tarayıcıda oda kurar ve kurucunun kendi kanalını döndürür. `code` verilirse (sayfa
 * yenilenince aynı oda) önce o kod denenir; doluysa yeni kod üretilir.
 */
export async function hostRoom(opts: {
  bots: number;
  speed: number;
  code?: string;
}): Promise<ClientLink> {
  let peer: Peer | null = null;
  let code = '';
  for (let attempt = 0; !peer; attempt++) {
    const reuse = opts.code && attempt < REHOST_RETRIES;
    code = reuse ? opts.code! : makeRoomCode(Math.random);
    const got = await register(peerId(code));
    if (got !== 'taken') peer = got;
    else if (reuse) await new Promise((r) => window.setTimeout(r, REHOST_RETRY_MS));
    else if (attempt > REHOST_RETRIES + 5) throw new NetError('unreachable');
  }

  const host = new RoomHost({
    code,
    botCount: opts.bots,
    speedScale: opts.speed,
    arenaRadius: ARENA_RADIUS,
    lan: await localAddresses(),
    ticker: new WorkerTicker(),
    now: () => performance.now(),
  });
  const p = peer;
  p.on('connection', (conn) => admit(host, conn));
  // Eşleştirme sunucusuyla bağ koparsa yeni gelenler bulabilsin diye yeniden bağlan
  // (kurulu oyun bağlantıları bundan etkilenmez)
  p.on('disconnected', () => {
    if (!p.destroyed) window.setTimeout(() => !p.destroyed && p.reconnect(), 2000);
  });
  p.on('error', () => {});
  // Sekme kapanınca arkadaşlar beklemeden odanın bittiğini öğrensin
  const onHide = () => p.destroy();
  window.addEventListener('pagehide', onHide);

  const link = loopback(host);
  const close = link.close.bind(link);
  link.close = () => {
    close();
    window.removeEventListener('pagehide', onHide);
    p.destroy();
  };
  return link;
}

/** Koddaki odaya (kurucunun tarayıcısına) bağlanır. */
export function dialRoom(code: string): Promise<ClientLink> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerOptions());
    let settled = false;
    /** Eşleştirme sunucusuna ulaşıldı: bundan sonraki başarısızlık iki tarayıcı arasındadır. */
    let signalled = false;
    const fail = (err: NetError) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      peer.destroy();
      reject(err);
    };
    const timer = window.setTimeout(
      () => fail(new NetError(signalled ? 'p2pFailed' : 'unreachable')),
      DIAL_TIMEOUT_MS,
    );
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') fail(new NetError('notFound'));
      else if (err.type === 'browser-incompatible') fail(new NetError('noWebrtc'));
      else fail(new NetError(signalled ? 'p2pFailed' : 'unreachable'));
    });
    peer.once('open', () => {
      signalled = true;
      const conn = peer.connect(peerId(code), {
        reliable: true,
        serialization: 'raw',
        metadata: { v: PROTOCOL_VERSION },
      });
      conn.once('open', () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        // Oyun verisi artık doğrudan akıyor; geç gelen ağ adaylarından sonra eşleştirme
        // sunucusundan ayrıl (kurucu odayı orada tutmaya devam eder)
        window.setTimeout(() => !peer.destroyed && peer.disconnect(), SIGNAL_LINGER_MS);
        resolve(peerLink(peer, conn));
      });
      // Ağlar (NAT/güvenlik duvarı) bağlantıya izin vermedi: süre dolmasını bekleme
      conn.on('iceStateChanged', (state) => {
        if (state === 'failed') fail(new NetError('p2pFailed'));
      });
      conn.once('close', () => fail(new NetError('p2pFailed')));
      conn.once('error', () => fail(new NetError('p2pFailed')));
    });
  });
}

function peerLink(peer: Peer, conn: DataConnection): ClientLink {
  const chunks = new ChunkAssembler();
  let open = true;
  let lastData = performance.now();
  const link: ClientLink = {
    onmessage: null,
    onclose: null,
    get open() {
      return open && conn.open;
    },
    send(data) {
      if (link.open) conn.send(data);
    },
    close() {
      if (!open) return;
      open = false;
      window.clearInterval(watchdog);
      conn.close();
      peer.destroy();
    },
  };
  const lost = () => {
    if (!open) return;
    link.close();
    link.onclose?.();
  };
  const watchdog = window.setInterval(() => {
    if (performance.now() - lastData > SILENCE_TIMEOUT_MS) lost();
  }, 1000);
  conn.on('data', (data) => {
    lastData = performance.now();
    if (typeof data === 'string') {
      link.onmessage?.(data);
    } else if (data instanceof ArrayBuffer) {
      const whole = chunks.push(data);
      if (whole) link.onmessage?.(whole);
    }
  });
  conn.on('close', lost);
  conn.on('error', lost);
  return link;
}
