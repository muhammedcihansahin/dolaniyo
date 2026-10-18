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
/**
 * Eşleştirme sunucusuna ulaştıktan sonra kurucunun tarayıcısına doğrudan/aktarıcı üzerinden
 * bağlanma süresi sınırı (TCP/TLS aktarıcılar UDP'den geç devreye girer).
 */
const DIAL_TIMEOUT_MS = 30_000;
/** Aktarıcı (TURN) kimlik bilgilerini getirme süresi sınırı; aşılırsa onlarsız devam edilir. */
const TURN_FETCH_TIMEOUT_MS = 4000;
/** Getirilen aktarıcı kimlik bilgileri bu süre boyunca yeniden kullanılır. */
const TURN_CACHE_MS = 10 * 60_000;
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
 * katı NAT'lerde doğrudan bağlantı kurulamaz, veri bir TURN aktarıcısı üzerinden gider.
 *
 * Kayıt gerektirmeyen ücretsiz aktarıcılar garanti vermez (Open Relay'in eski ortak şifresi
 * artık çalışmıyor; kaldırıldı). Hepsi birlikte denenir; UDP'yi engelleyen ağlar için TCP de.
 * Güvenilir bir aktarıcı için derlemede:
 *  - `VITE_TURN_URL`: aktarıcı kimlik bilgilerini veren adres (ör. Metered:
 *    `https://APP.metered.live/api/v1/turn/credentials?apiKey=ANAHTAR`); yanıt RTCIceServer[]
 *    ya da `{ iceServers: RTCIceServer[] }`. Bağlanmadan önce getirilir.
 *  - `VITE_ICE_SERVERS`: sabit ek sunucular (RTCIceServer[] JSON).
 * GitHub Pages derlemesi bunları depo değişkenlerinden (`TURN_URL`, `ICE_SERVERS`) alır.
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  {
    urls: [
      'turn:eu-0.turn.peerjs.com:3478',
      'turn:us-0.turn.peerjs.com:3478',
      'turn:eu-0.turn.peerjs.com:3478?transport=tcp',
      'turn:us-0.turn.peerjs.com:3478?transport=tcp',
    ],
    username: 'peerjs',
    credential: 'peerjsp',
  },
  {
    urls: ['turn:freestun.net:3478', 'turn:freestun.net:3478?transport=tcp'],
    username: 'free',
    credential: 'free',
  },
];

function isIceList(v: unknown): v is RTCIceServer[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'object' && s !== null && 'urls' in s);
}

/** Derlemede verilen sabit ek sunucular (`VITE_ICE_SERVERS`). */
function configuredIceServers(): RTCIceServer[] {
  const extra = import.meta.env.VITE_ICE_SERVERS as string | undefined;
  if (!extra) return [];
  try {
    const list = JSON.parse(extra) as unknown;
    return isIceList(list) ? list : [];
  } catch {
    return [];
  }
}

let turnCache: { at: number; list: RTCIceServer[] } | null = null;

/** `VITE_TURN_URL` verildiyse aktarıcı kimlik bilgilerini getirir (olmazsa boş liste). */
async function fetchedIceServers(): Promise<RTCIceServer[]> {
  const url = import.meta.env.VITE_TURN_URL as string | undefined;
  if (!url) return [];
  if (turnCache && performance.now() - turnCache.at < TURN_CACHE_MS) return turnCache.list;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), TURN_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return [];
    const body = (await res.json()) as unknown;
    const list = isIceList(body) ? body : (body as { iceServers?: unknown } | null)?.iceServers;
    if (!isIceList(list)) return [];
    turnCache = { at: performance.now(), list };
    return list;
  } catch {
    return [];
  } finally {
    window.clearTimeout(timer);
  }
}

async function iceServers(): Promise<RTCIceServer[]> {
  return [...(await fetchedIceServers()), ...configuredIceServers(), ...ICE_SERVERS];
}

/**
 * PeerJS seçenekleri. Eşleştirme sunucusu varsayılan olarak PeerJS'in ücretsiz bulut sunucusu;
 * `VITE_PEER_SERVER=host:port/yol` ile kendi PeerJS sunucunuz kullanılabilir (yerel deneme).
 */
async function peerOptions(): Promise<PeerOptions> {
  const opts: PeerOptions = { debug: 0, config: { iceServers: await iceServers() } };
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
async function register(id: string): Promise<Peer | 'taken'> {
  const opts = await peerOptions();
  return new Promise((resolve, reject) => {
    const peer = new Peer(id, opts);
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

/** Katılırken ne kadar ilerlendiği: başarısız olunca hangi adımda takıldığını söylemek için. */
interface DialProgress {
  /** Kurucu teklife yanıt verdi (tarayıcısı açık ve uyanık). */
  answered: boolean;
  /** Bu tarayıcı bir aktarıcıdan (TURN) adres alabildi. */
  relayHere: boolean;
  /** Kurucunun tarayıcısı bir aktarıcıdan adres alabildi. */
  relayHost: boolean;
}

const RELAY_CANDIDATE = / typ relay /;

/** Bağlantının ağ adaylarını ve kurucunun yanıtını izler (PeerJS'in kendi dinleyicilerine dokunmadan). */
function watchDial(conn: DataConnection, progress: DialProgress): void {
  const pc = conn.peerConnection as RTCPeerConnection | null | undefined;
  if (!pc) return;
  pc.addEventListener('icecandidate', (e) => {
    if (e.candidate && RELAY_CANDIDATE.test(e.candidate.candidate)) progress.relayHere = true;
  });
  pc.addEventListener('signalingstatechange', () => {
    if (pc.signalingState === 'stable' && pc.remoteDescription) progress.answered = true;
  });
  // Kurucunun adayları eşleştirme sunucusundan gelip buraya eklenir
  const add = pc.addIceCandidate.bind(pc) as (c?: RTCIceCandidateInit) => Promise<void>;
  pc.addIceCandidate = ((c?: RTCIceCandidateInit) => {
    if (c?.candidate && RELAY_CANDIDATE.test(c.candidate)) progress.relayHost = true;
    return add(c);
  }) as RTCPeerConnection['addIceCandidate'];
}

/** Kurucuyla bağlantı kurulamadığında doğru hatayı seçer. */
function dialError(progress: DialProgress): NetError {
  if (!progress.answered) return new NetError('noAnswer');
  return new NetError('p2pFailed', {
    here: progress.relayHere ? '✓' : '✗',
    host: progress.relayHost ? '✓' : '✗',
  });
}

/** Koddaki odaya (kurucunun tarayıcısına) bağlanır. */
export async function dialRoom(code: string): Promise<ClientLink> {
  const opts = await peerOptions();
  return new Promise((resolve, reject) => {
    const peer = new Peer(opts);
    const progress: DialProgress = { answered: false, relayHere: false, relayHost: false };
    let settled = false;
    const fail = (err: NetError) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      peer.destroy();
      reject(err);
    };
    let timer = window.setTimeout(() => fail(new NetError('unreachable')), CONNECT_TIMEOUT_MS);
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') fail(new NetError('notFound'));
      else if (err.type === 'browser-incompatible') fail(new NetError('noWebrtc'));
      // Eşleştirme sunucusuyla ilgili hata: kurucu yanıt verdiyse sorun iki tarayıcı arasında
      else fail(progress.answered ? dialError(progress) : new NetError('unreachable'));
    });
    peer.once('open', () => {
      if (settled) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fail(dialError(progress)), DIAL_TIMEOUT_MS);
      const conn = peer.connect(peerId(code), {
        reliable: true,
        serialization: 'raw',
        metadata: { v: PROTOCOL_VERSION },
      });
      watchDial(conn, progress);
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
        if (state === 'failed') fail(dialError(progress));
      });
      conn.once('close', () => fail(dialError(progress)));
      conn.once('error', () => fail(dialError(progress)));
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
