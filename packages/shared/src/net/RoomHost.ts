import { SNAKE_COLOR_COUNT } from '../colors';
import { TICK_RATE, changeSpeedScale, type SpeedChange } from '../config';
import { guestName, sanitizeNick } from '../nick';
import { BotController } from '../sim/bots/BotController';
import { World } from '../sim/World';
import { MAX_ROOM_PLAYERS, decodeInput, type ClientMessage, type ServerMessage } from './protocol';
import { WorldEncoder } from './WorldEncoder';

const TICK_MS = 1000 / TICK_RATE;
/** Saniyede kabul edilen en fazla girdi mesajı (istemci ~30 gönderir). */
const MAX_INPUTS_PER_SEC = 90;
const MIN_SPAWN_INTERVAL_MS = 500;
/** Gönderilemeyen veri bunu aşarsa bağlantı yavaş sayılır ve kesilir. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_LENGTH = 4096;

/** Odadaki bir kişiye giden tek yönlü kanal (WebRTC veri kanalı ya da aynı sayfadaki kurucu). */
export interface RoomLink {
  send(data: string | Uint8Array<ArrayBuffer>): void;
  /** Gönderilmeyi bekleyen bayt. */
  readonly buffered: number;
  close(): void;
}

/**
 * Döngüyü süren saat: `start`a verilen işlev sık sık (ör. ~10 ms'de bir) çağrılır, sıradaki
 * tick'lerin zamanı geldiyse oda onları çalıştırır. Tarayıcıda arka plan sekmesi
 * yavaşlatmasına takılmasın diye bir Worker'dan beslenir.
 */
export interface RoomTicker {
  start(fn: () => void): void;
  stop(): void;
}

export interface RoomOptions {
  code: string;
  botCount: number;
  speedScale: number;
  arenaRadius: number;
  /** Paylaşım bağlantısı için kurucunun yerel ağ adresleri (yerelde açıldıysa). */
  lan: string[];
  ticker: RoomTicker;
  now?: () => number;
}

export class RoomMember {
  snakeId = 0;
  lastSpawnAt = -Infinity;
  inputWindowStart = 0;
  inputCount = 0;
  /** Sekmesi arka planda (istemci `away` mesajıyla bildirir). */
  away = false;

  constructor(
    readonly link: RoomLink,
    /** Odayı kuran kişi: oyun hızını her zaman değiştirebilir. */
    readonly owner: boolean,
  ) {}
}

/**
 * Tek oda: kendi dünyası, botları ve 30 Hz tick döngüsü. Odayı kuran kişinin tarayıcısında
 * çalışır; o kişi dahil herkes `RoomLink` üzerinden aynı ikili akışı alır.
 *
 * Odada tek kişi varken o kişinin sekmesi arka plana geçerse oda duraklar (botlu tek kişilik
 * oyun gibi); en az bir başka kişi varsa oyun her zaman akar.
 */
export class RoomHost {
  readonly world: World;
  readonly members = new Set<RoomMember>();
  readonly code: string;
  readonly botCount: number;
  private readonly bots: BotController;
  private readonly encoder: WorldEncoder;
  private readonly lan: string[];
  private readonly ticker: RoomTicker;
  private readonly now: () => number;
  private running = false;
  private nextTickAt = 0;
  private closed = false;

  constructor(opts: RoomOptions) {
    this.code = opts.code;
    this.botCount = opts.botCount;
    this.lan = opts.lan;
    this.ticker = opts.ticker;
    this.now = opts.now ?? Date.now;
    this.world = new World(
      { arenaRadius: opts.arenaRadius, speedScale: opts.speedScale },
      (Math.random() * 2 ** 32) >>> 0,
    );
    this.bots = new BotController(this.world, {
      botCount: opts.botCount,
      randomInitialScores: true,
    });
    this.encoder = new WorldEncoder(this.world);
  }

  get players(): number {
    let n = 0;
    for (const m of this.members) if (m.snakeId) n++;
    return n;
  }

  /** Yeni kişiyi odaya alır; oda doluysa hata gönderip kanalı kapatır ve null döner. */
  add(link: RoomLink, owner = false): RoomMember | null {
    if (this.closed) {
      link.close();
      return null;
    }
    if (this.members.size >= MAX_ROOM_PLAYERS) {
      send(link, { t: 'error', code: 'full' });
      link.close();
      return null;
    }
    const m = new RoomMember(link, owner);
    this.members.add(m);
    send(link, {
      t: 'joined',
      code: this.code,
      bots: this.botCount,
      maxPlayers: MAX_ROOM_PLAYERS,
      cfg: this.world.cfg,
      lan: this.lan,
    });
    link.send(this.encoder.encodeInit());
    this.broadcastPeople();
    this.updateRunning();
    return m;
  }

  remove(m: RoomMember): void {
    if (!this.members.delete(m)) return;
    this.despawn(m);
    this.broadcastPeople();
    this.updateRunning();
  }

  /** Bir kişiden gelen mesaj: metin = JSON kontrol mesajı, ikili = girdi. */
  receive(m: RoomMember, data: string | Uint8Array): void {
    if (!this.members.has(m)) return;
    if (typeof data !== 'string') {
      this.input(m, data);
      return;
    }
    const msg = parseMessage(data);
    if (!msg) {
      send(m.link, { t: 'error', code: 'badRequest' });
      return;
    }
    switch (msg.t) {
      case 'spawn':
        this.spawn(m, msg.name, msg.color);
        return;
      case 'leave':
        this.despawn(m);
        return;
      case 'away':
        m.away = msg.away;
        this.updateRunning();
        return;
      case 'speed':
        this.changeSpeed(m, msg.change);
        return;
    }
  }

  /** Odayı kapatır: döngü durur, herkesin kanalı kapanır. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopLoop();
    for (const m of this.members) m.link.close();
    this.members.clear();
  }

  /** Tek kişi kaldıysa ve sekmesi arka plandaysa true. */
  private get paused(): boolean {
    if (this.members.size !== 1) return false;
    for (const m of this.members) return m.away;
    return false;
  }

  /** Üyelik veya arka plan durumu değişince döngüyü durdurur/sürdürür. */
  private updateRunning(): void {
    if (this.closed) return;
    if (this.paused || this.members.size === 0) {
      this.stopLoop();
    } else if (!this.running) {
      this.running = true;
      this.nextTickAt = this.now();
      this.ticker.start(this.pump);
    }
  }

  private stopLoop(): void {
    if (!this.running) return;
    this.running = false;
    this.ticker.stop();
  }

  /** Sabit adımlı döngü: saat geç kalırsa birikmiş tick'ler arka arkaya çalışır. */
  private readonly pump = (): void => {
    if (!this.running) return;
    const now = this.now();
    let n = 0;
    while (this.nextTickAt <= now && n < 5) {
      this.step();
      this.nextTickAt += TICK_MS;
      n++;
    }
    if (n === 5) this.nextTickAt = now + TICK_MS; // çok geride kaldık: yakalamaya çalışma
  };

  private spawn(m: RoomMember, name: string, color: number): void {
    const now = this.now();
    if (m.snakeId || now - m.lastSpawnAt < MIN_SPAWN_INTERVAL_MS) return;
    m.lastSpawnAt = now;
    const s = this.world.addSnake({
      name: sanitizeNick(name) ?? guestName(Math.random),
      color: Number.isInteger(color) ? Math.min(Math.max(color, 0), SNAKE_COLOR_COUNT - 1) : 0,
    });
    m.snakeId = s.id;
    send(m.link, { t: 'spawned', id: s.id });
  }

  private despawn(m: RoomMember): void {
    if (!m.snakeId) return;
    this.world.removeSnake(m.snakeId);
    m.snakeId = 0;
  }

  private input(m: RoomMember, data: Uint8Array): void {
    const now = this.now();
    if (now - m.inputWindowStart >= 1000) {
      m.inputWindowStart = now;
      m.inputCount = 0;
    }
    if (++m.inputCount > MAX_INPUTS_PER_SEC || !m.snakeId) return;
    const inp = decodeInput(data);
    if (inp) this.world.setInput(m.snakeId, inp.angle, inp.boost);
  }

  /** Kurucu ya da odada kendisinden başka gerçek oyuncu yılanı yoksa hızı değiştirir. */
  private changeSpeed(m: RoomMember, change: SpeedChange): void {
    let othersPlaying = false;
    for (const o of this.members) if (o !== m && o.snakeId) othersPlaying = true;
    if (!m.owner && othersPlaying) {
      send(m.link, { t: 'speedDenied' });
      return;
    }
    this.world.setSpeedScale(changeSpeedScale(this.world.cfg.speedScale, change));
    const speed = this.world.cfg.speedScale;
    for (const o of this.members) send(o.link, { t: 'speed', speed });
  }

  private step(): void {
    this.bots.update();
    this.world.step();
    const events = this.world.drainEvents();
    for (const e of events) {
      if (e.type !== 'died') continue;
      for (const m of this.members) if (m.snakeId === e.id) m.snakeId = 0;
    }
    // Akış hiç kesilmemeli (istemci gövdeleri her tick'ten kurar)
    const msg = this.encoder.encodeTick(events);
    for (const m of this.members) {
      if (m.link.buffered > MAX_BUFFERED_BYTES) {
        m.link.close();
        continue;
      }
      m.link.send(msg);
    }
  }

  private broadcastPeople(): void {
    for (const m of this.members) send(m.link, { t: 'people', count: this.members.size });
  }
}

function send(link: RoomLink, msg: ServerMessage): void {
  link.send(JSON.stringify(msg));
}

function parseMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_TEXT_LENGTH) return null;
  try {
    const msg = JSON.parse(raw) as Partial<ClientMessage> & Record<string, unknown>;
    switch (msg.t) {
      case 'spawn':
        return typeof msg.name === 'string' && typeof msg.color === 'number'
          ? { t: 'spawn', name: msg.name, color: msg.color }
          : null;
      case 'leave':
        return { t: 'leave' };
      case 'away':
        return typeof msg.away === 'boolean' ? { t: 'away', away: msg.away } : null;
      case 'speed':
        return msg.change === 'up' || msg.change === 'down' || msg.change === 'reset'
          ? { t: 'speed', change: msg.change }
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}
