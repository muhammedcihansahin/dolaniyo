import {
  BinMsg,
  WorldMirror,
  angleDiff,
  binaryType,
  encodeInput,
  type ClientMessage,
  type ServerMessage,
  type SimEvent,
  type Snake,
  type SpeedChange,
} from '@yilan/shared';
import type { GameSession, PlayerDeath } from '../game/GameSession';
import { NetError, type NetErrorCode } from './errors';
import { dialRoom, hostRoom, type ClientLink } from './p2p';

export { NetError, type NetErrorCode };

/**
 * `create`: bu tarayıcıda oda kur (`code` verilirse önce o kod denenir: sayfa yenilenince
 * aynı oda). `join`: koddaki odaya bağlan.
 */
export type JoinRequest =
  { t: 'create'; bots: number; speed: number; code?: string } | { t: 'join'; code: string };

export interface RoomInfo {
  code: string;
  bots: number;
  /** Odanın oyun hızı çarpanı (kuran belirler). */
  speed: number;
  maxPlayers: number;
  lan: string[];
  /** Odaya bağlı kişi sayısı (menüdekiler dahil). */
  people: number;
  /** Oda bu tarayıcıda çalışıyor (biz kurduk); çıkınca oda kapanır. */
  hosting: boolean;
}

const JOIN_TIMEOUT_MS = 10_000;
/** Ağ titremesine karşı oynatmaya başlamadan önce biriktirilen tick sayısı. */
const START_BUFFER = 2;
/** Bundan fazla tick birikirse fazlası hemen uygulanır (gecikme büyümesin). */
const MAX_BUFFER = 4;
/** Bundan fazla tick birikirse (kare gelmiyorsa) mesaj geldikçe uygulanır. */
const HARD_BUFFER = 45;
const INPUT_MIN_MS = 33;
const INPUT_KEEPALIVE_MS = 250;

/**
 * Oda oturumu: kurucudaki dünyanın aynasını tutar, tick'leri küçük bir tamponla oynatır,
 * oyuncunun yön/boost girdisini kurucuya yollar. Odayı biz kurduysak kurucu bu sayfadadır
 * ve kanal aynı sayfa içindedir; oyun kodu iki durumu ayırt etmez.
 */
export class NetGame implements GameSession {
  readonly world: WorldMirror;
  readonly room: RoomInfo;
  onPlayerDied: ((death: PlayerDeath) => void) | null = null;
  onSpeedChanged: ((speed: number | null) => void) | null = null;
  /** Bağlantı beklenmedik şekilde koptu. */
  onClosed: ((code: NetErrorCode) => void) | null = null;
  /** Oda bilgisi (kişi sayısı) değişti. */
  onRoomChange: (() => void) | null = null;
  lastEvents: SimEvent[] = [];

  private readonly queue: ArrayBuffer[] = [];
  private buffering = true;
  private playerId = 0;
  private disposed = false;
  private sentAngle = 0;
  private sentBoost = false;
  private sentAt = 0;

  /** Odayı kurar veya odaya katılır; oda hazır olunca çözülür. */
  static async connect(req: JoinRequest): Promise<NetGame> {
    if (typeof RTCPeerConnection === 'undefined') throw new NetError('noWebrtc');
    const link =
      req.t === 'create'
        ? await hostRoom({ bots: req.bots, speed: req.speed, code: req.code })
        : await dialRoom(req.code);
    return new Promise((resolve, reject) => {
      let settled = false;
      // INIT, `joined`dan hemen sonra gelir: NetGame kurulana dek beklet
      const early: ArrayBuffer[] = [];
      const fail = (code: NetErrorCode) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        link.onclose = link.onmessage = null;
        link.close();
        reject(new NetError(code));
      };
      const timer = window.setTimeout(() => fail('unreachable'), JOIN_TIMEOUT_MS);
      link.onclose = () => fail('unreachable');
      link.onmessage = (data) => {
        if (typeof data !== 'string') {
          early.push(data);
          return;
        }
        const msg = JSON.parse(data) as ServerMessage;
        if (msg.t === 'error') {
          fail(msg.code);
        } else if (msg.t === 'joined') {
          settled = true;
          window.clearTimeout(timer);
          resolve(
            new NetGame(
              link,
              {
                code: msg.code,
                bots: msg.bots,
                speed: msg.cfg.speedScale,
                maxPlayers: msg.maxPlayers,
                lan: msg.lan,
                people: 1,
                hosting: req.t === 'create',
              },
              new WorldMirror(msg.cfg),
              early,
            ),
          );
        }
      };
    });
  }

  private constructor(
    private readonly link: ClientLink,
    room: RoomInfo,
    world: WorldMirror,
    early: ArrayBuffer[],
  ) {
    this.room = room;
    this.world = world;
    link.onmessage = (data) => this.onMessage(data);
    for (const data of early) this.onMessage(data);
    link.onclose = () => {
      document.removeEventListener('visibilitychange', this.onVisibility);
      if (this.disposed) return;
      this.disposed = true;
      this.onClosed?.('closed');
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    if (document.hidden) this.onVisibility();
  }

  /**
   * Sekme arka plana geçince/öne gelince kurucuya bildirir: odada başka gerçek oyuncu yoksa
   * oda duraklar, varsa oyun akmaya devam eder (aynaya da mesaj geldikçe uygulanır).
   */
  private readonly onVisibility = (): void => {
    this.send({ t: 'away', away: document.hidden });
  };

  get player(): Snake | null {
    return this.playerId ? (this.world.snakes.get(this.playerId) ?? null) : null;
  }

  join(name: string, color: number): void {
    this.send({ t: 'spawn', name, color });
  }

  leave(): void {
    this.playerId = 0;
    this.send({ t: 'leave' });
  }

  /** Oda hızını doğrudan ayarla (kurucunun menüdeki sürgüsü). */
  setSpeed(scale: number): void {
    this.send({ t: 'speed', set: scale });
  }

  /** Kurucu yetkiyi denetler; sonuç `speed` ya da `speedDenied` mesajıyla gelir. */
  changeSpeed(change: SpeedChange): void {
    this.send({ t: 'speed', change });
  }

  setInput(angle: number, boost: boolean): void {
    if (!this.playerId || !this.link.open) return;
    const now = performance.now();
    const since = now - this.sentAt;
    const turned = Math.abs(angleDiff(this.sentAngle, angle)) > 0.004;
    if (
      boost === this.sentBoost &&
      (since < INPUT_MIN_MS || (!turned && since < INPUT_KEEPALIVE_MS))
    ) {
      return;
    }
    this.link.send(encodeInput(angle, boost));
    this.sentAngle = angle;
    this.sentBoost = boost;
    this.sentAt = now;
  }

  step(): boolean {
    const q = this.queue;
    if (this.buffering) {
      if (q.length < START_BUFFER) return false;
      this.buffering = false;
    }
    if (q.length === 0) {
      this.buffering = true;
      return false;
    }
    const events: SimEvent[] = [];
    while (q.length > MAX_BUFFER) events.push(...this.applyNext());
    events.push(...this.applyNext());
    this.lastEvents = events;
    return true;
  }

  /** Odadan çık: bağlantıyı kapatır (odayı biz kurduysak oda da kapanır). */
  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.disposed) return;
    this.disposed = true;
    this.link.close();
  }

  private send(msg: ClientMessage): void {
    if (this.link.open) this.link.send(JSON.stringify(msg));
  }

  private onMessage(data: string | ArrayBuffer): void {
    if (typeof data === 'string') {
      const msg = JSON.parse(data) as ServerMessage;
      if (msg.t === 'spawned') {
        this.playerId = msg.id;
        this.sentAt = 0;
      } else if (msg.t === 'people') {
        this.room.people = msg.count;
        this.onRoomChange?.();
      } else if (msg.t === 'speed') {
        this.room.speed = msg.speed;
        this.world.setSpeedScale(msg.speed);
        this.onRoomChange?.();
        this.onSpeedChanged?.(msg.speed);
      } else if (msg.t === 'speedDenied') {
        this.onSpeedChanged?.(null);
      }
      return;
    }
    const type = binaryType(data);
    if (type === BinMsg.Init) {
      this.queue.length = 0;
      this.buffering = true;
      this.world.apply(data);
    } else if (type === BinMsg.Tick) {
      this.queue.push(data);
      // Arka planda kare çizilmez: oyun akmaya devam etsin diye tick'ler geldikçe uygulanır
      if (this.queue.length > (document.hidden ? MAX_BUFFER : HARD_BUFFER)) {
        while (this.queue.length > MAX_BUFFER) this.applyNext();
      }
    }
  }

  private applyNext(): SimEvent[] {
    const data = this.queue.shift();
    if (!data) return [];
    const events = this.world.apply(data);
    for (const e of events) {
      if (e.type !== 'died' || !this.playerId || e.id !== this.playerId) continue;
      this.playerId = 0;
      const killer = e.killerId ? this.world.snakes.get(e.killerId) : undefined;
      this.onPlayerDied?.({ score: e.score, reason: e.reason, killerName: killer?.name ?? null });
    }
    return events;
  }
}
