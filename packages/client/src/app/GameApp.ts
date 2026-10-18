import {
  DT,
  SNAKE_COLOR_COUNT,
  guestName,
  normalizeRoomCode,
  parseNickInput,
  type SimEvent,
  type SnakeLike,
} from '@yilan/shared';
import { Application } from 'pixi.js';
import type { GameSession, PlayerDeath } from '../game/GameSession';
import { Input } from '../input/Input';
import { NetError, NetGame, type JoinRequest, type NetErrorCode } from '../net/NetGame';
import { OfflineGame } from '../offline/OfflineGame';
import { Renderer } from '../render/Renderer';
import { t } from '../i18n';
import { storage } from '../storage';
import { Hud, type MinimapSnake } from '../ui/Hud';
import { Fullscreen } from '../ui/Fullscreen';
import { Menu } from '../ui/Menu';

type Mode = 'menu' | 'playing' | 'dying';

const MAX_STEPS_PER_FRAME = 4;
const DEATH_TO_MENU_MS = 900;
const SPECTATE_SWITCH_SECONDS = 8;
/** Paylaşım bağlantısındaki oda kodu parametresi: ?oda=K7QXP */
const ROOM_PARAM = 'oda';
/** Bu sekmede kurduğumuz oda (sessionStorage): sayfa yenilenince aynı kodla yeniden kurulur. */
const HOSTED_KEY = 'yilan.hosted';
/** Kurucu sayfayı yenilerse oda birkaç saniye içinde aynı kodla geri gelir: o arada yeniden dene. */
const REJOIN_ATTEMPTS = 4;
const REJOIN_DELAY_MS = 2500;

interface HostedRoom {
  code: string;
  bots: number;
  speed: number;
}

function hostedRoom(): HostedRoom | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(HOSTED_KEY) ?? 'null') as HostedRoom | null;
    return v && typeof v.code === 'string' ? v : null;
  } catch {
    return null;
  }
}

function setHostedRoom(v: HostedRoom | null): void {
  try {
    if (v) sessionStorage.setItem(HOSTED_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(HOSTED_KEY);
  } catch {
    // depolama yok: yenileyince oda yeniden kurulamaz, sorun değil
  }
}

/**
 * Uygulama durum makinesi: Menü → Oyun → (Ölüm) → Menü. Oturum ya çevrimdışı (botlarla)
 * ya da bir odadır; odadayken menü arka planda odanın dünyasını gösterir.
 */
export class GameApp {
  private readonly pixi = new Application();
  private offline!: OfflineGame;
  private net: NetGame | null = null;
  private connecting = false;
  private renderer!: Renderer;
  private input!: Input;
  private menu!: Menu;
  private hud!: Hud;

  private mode: Mode = 'menu';
  private acc = 0;
  private spectateId = 0;
  private spectateTimer = 0;
  private statsTimer = 0;
  private boardTimer = 0;
  private minimapTimer = 0;
  private frames = 0;
  private fpsTimer = 0;
  private fps = 0;
  /** Bu hayatta öldürülen yılan sayısı (HUD). */
  private kills = 0;

  constructor(private readonly mount: HTMLElement) {}

  private get game(): GameSession {
    return this.net ?? this.offline;
  }

  async start(): Promise<void> {
    await this.pixi.init({
      resizeTo: window,
      background: 0x0a1633,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 1.5),
      preference: 'webgl',
      // Çift ekran kartlı dizüstülerde tarayıcı tümleşik kartı değil, güçlü kartı seçsin
      powerPreference: 'high-performance',
    });
    // Girdi DOM olaylarıyla okunur; Pixi her fare hareketinde sahne ağacında isabet aramasın
    this.pixi.stage.eventMode = 'none';
    this.mount.appendChild(this.pixi.canvas);
    new Fullscreen(); // menüden önce: menü, düğme yoksa tam ekran ipucunu göstermez

    this.menu = new Menu({
      play: (raw) => this.play(raw),
      botsChanged: (n) => this.offline.setBotCount(n),
      speedChanged: (v) => this.offline.setSpeedScale(v),
      createRoom: (bots, speed) => void this.connectRoom({ t: 'create', bots, speed }),
      joinRoom: (raw) => this.joinRoom(raw),
      leaveRoom: () => this.exitRoom(null),
      roomSpeed: (v) => this.net?.setSpeed(v),
    });
    this.offline = new OfflineGame(this.menu.botCount, this.menu.speedScale);
    this.offline.onPlayerDied = (d) => this.onPlayerDied(d);
    this.offline.onSpeedChanged = (v) => {
      if (v !== null) this.menu.setSpeedScale(v);
      this.showSpeed(v);
    };
    this.renderer = new Renderer(this.pixi, this.offline.world);
    this.input = new Input(this.pixi.canvas);
    this.input.onEscape = () => this.leaveToMenu();
    this.input.onSpeedKey = (change) => {
      if (this.mode === 'playing') this.game.changeSpeed(change);
    };
    this.hud = new Hud(() => this.leaveToMenu());
    this.menu.show(null);

    const code = normalizeRoomCode(new URLSearchParams(location.search).get(ROOM_PARAM) ?? '');
    const hosted = hostedRoom();
    if (code && hosted?.code === code) {
      // Odayı bu sekmede biz kurmuştuk: sayfa yenilendi, aynı kodla yeniden kur
      void this.connectRoom({ t: 'create', bots: hosted.bots, speed: hosted.speed, code });
    } else if (code) {
      this.joinRoom(code);
    }

    this.pixi.ticker.add((ticker) => this.frame(ticker.deltaMS));
  }

  private get color(): number {
    const saved = Number(storage.get('color'));
    if (Number.isInteger(saved) && saved >= 0 && saved < SNAKE_COLOR_COUNT) return saved;
    const c = Math.floor(Math.random() * SNAKE_COLOR_COUNT);
    storage.set('color', String(c));
    return c;
  }

  private play(raw: string): void {
    if (this.mode === 'playing' || this.connecting) return;
    const { nick } = parseNickInput(raw);
    this.game.join(nick ?? guestName(Math.random), this.color);
    this.mode = 'playing';
    this.input.reset();
    this.menu.hide();
    this.menu.setStatus(null);
    this.hud.show(true);
    this.renderer.startSpawnZoom();
    this.kills = 0;
    this.boardTimer = this.statsTimer = this.minimapTimer = 0;
  }

  /** `speed` null: odada hızı değiştirme izni yok. */
  private showSpeed(speed: number | null): void {
    if (this.mode !== 'playing') return;
    this.hud.flash(
      speed === null ? t('hud.speedDenied') : t('hud.speed', { value: speed.toFixed(2) }),
    );
  }

  private onPlayerDied(d: PlayerDeath): void {
    this.mode = 'dying';
    window.setTimeout(() => {
      if (this.mode === 'dying') this.toMenu(Math.floor(d.score));
    }, DEATH_TO_MENU_MS);
  }

  private leaveToMenu(): void {
    if (this.mode !== 'playing') return;
    const score = this.game.player?.score ?? 0;
    this.game.leave();
    this.toMenu(Math.floor(score));
  }

  private toMenu(lastScore: number | null): void {
    this.mode = 'menu';
    this.hud.show(false);
    this.menu.show(lastScore);
  }

  private joinRoom(raw: string): void {
    const code = normalizeRoomCode(raw);
    if (!code) {
      this.menu.setStatus('error.badCode');
      return;
    }
    void this.connectRoom({ t: 'join', code });
  }

  /** `quiet`: başarısızlıkta hata gösterme (yeniden bağlanma denemeleri). */
  private async connectRoom(req: JoinRequest, quiet = false): Promise<boolean> {
    if (this.connecting || this.net || this.mode !== 'menu') return false;
    this.connecting = true;
    this.menu.setBusy(true);
    try {
      this.enterRoom(await NetGame.connect(req));
      this.menu.setStatus(null);
      return true;
    } catch (err) {
      const code: NetErrorCode = err instanceof NetError ? err.code : 'unreachable';
      this.setRoomParam(null);
      setHostedRoom(null);
      this.menu.setStatus(quiet ? null : `error.${code}`);
      return false;
    } finally {
      this.connecting = false;
      this.menu.setBusy(false);
    }
  }

  /** Kurucuyla bağlantı koptu: oda aynı kodla geri gelirse yeniden katıl. */
  private async rejoin(code: string): Promise<void> {
    for (let i = 0; i < REJOIN_ATTEMPTS; i++) {
      this.menu.setStatus('menu.reconnecting', false);
      await new Promise((r) => window.setTimeout(r, REJOIN_DELAY_MS));
      // Bu arada oyuncu kendisi bir şey yaptıysa (oynadı, başka odaya girdi) vazgeç
      if (this.net || this.connecting || this.mode !== 'menu') return;
      if (await this.connectRoom({ t: 'join', code }, true)) return;
    }
    this.menu.setStatus('error.closed');
  }

  private enterRoom(net: NetGame): void {
    this.net = net;
    net.onPlayerDied = (d) => this.onPlayerDied(d);
    net.onClosed = (code) => this.exitRoom(code);
    net.onRoomChange = () => this.menu.setRoom(net.room);
    net.onSpeedChanged = (v) => this.showSpeed(v);
    this.renderer.setWorld(net.world);
    this.acc = 0;
    this.spectateTimer = 0;
    this.menu.setRoom(net.room);
    this.setRoomParam(net.room.code);
    if (net.room.hosting) {
      setHostedRoom({ code: net.room.code, bots: net.room.bots, speed: net.room.speed });
    }
  }

  /** Odadan çık (düğmeyle) veya bağlantı koptu (`code`): çevrimdışı oyuna dön. */
  private exitRoom(code: NetErrorCode | null): void {
    const net = this.net;
    if (!net) return;
    const score = net.player?.score ?? null;
    this.net = null;
    net.onPlayerDied = net.onClosed = net.onRoomChange = null;
    net.onSpeedChanged = null;
    net.dispose();
    this.renderer.setWorld(this.offline.world);
    this.acc = 0;
    this.spectateTimer = 0;
    this.menu.setRoom(null);
    this.setRoomParam(null);
    setHostedRoom(null);
    if (this.mode !== 'menu') this.toMenu(score !== null ? Math.floor(score) : null);
    this.menu.setStatus(code ? `error.${code}` : null);
    if (code === 'closed' && !net.room.hosting) void this.rejoin(net.room.code);
  }

  /** Sayfa yenilenince aynı odaya dönülsün diye kodu adres çubuğunda tutar. */
  private setRoomParam(code: string | null): void {
    const url = new URL(location.href);
    if (code) url.searchParams.set(ROOM_PARAM, code);
    else url.searchParams.delete(ROOM_PARAM);
    history.replaceState(null, '', url);
  }

  private frame(deltaMS: number): void {
    const dt = Math.min(deltaMS / 1000, 0.25);
    this.countFps(dt);
    const game = this.game;

    const player = game.player;
    if (this.mode === 'playing' && player) {
      const inp = this.input.read(player.angle);
      game.setInput(inp.angle, inp.boost);
    }

    this.acc += dt;
    let steps = 0;
    while (this.acc >= DT && steps < MAX_STEPS_PER_FRAME) {
      // Tick'ten önceki oyuncu: bu tick'te ölürse de efektler onun ölümü/öldürmesi olarak çizilir
      const playerId = game.player?.id ?? 0;
      // Odada sıradaki tick henüz gelmediyse son durumda bekle (interpolasyon 1'de kalır)
      if (!game.step()) {
        this.acc = DT;
        break;
      }
      this.renderer.onEvents(game.lastEvents, playerId);
      if (playerId) this.countKills(game.lastEvents, playerId);
      this.acc -= DT;
      steps++;
    }
    if (this.acc > DT) this.acc = DT; // yetişemiyorsak geride kalanı at

    const own = game.player;
    const focus = own ?? (this.mode === 'menu' ? this.spectateTarget(dt) : null);
    this.renderer.render(this.acc / DT, dt, { snake: focus, own: own !== null }, true);

    if (this.mode === 'playing' && own) this.updateHud(dt, own);
  }

  private countKills(events: readonly SimEvent[], playerId: number): void {
    for (const e of events) {
      if (e.type === 'died' && e.killerId === playerId && e.id !== playerId) {
        this.kills++;
        this.statsTimer = 0;
      }
    }
  }

  /** Menüdeyken kamera skor tablosundaki ilk yılanlardan birini izler. */
  private spectateTarget(dt: number): SnakeLike | null {
    const world = this.game.world;
    this.spectateTimer -= dt;
    let target = world.snakes.get(this.spectateId) ?? null;
    if (!target || this.spectateTimer <= 0) {
      const top = world.getLeaderboard(3);
      target = top[Math.floor(Math.random() * top.length)] ?? null;
      this.spectateId = target?.id ?? 0;
      this.spectateTimer = SPECTATE_SWITCH_SECONDS;
    }
    return target;
  }

  private updateHud(dt: number, me: SnakeLike): void {
    const world = this.game.world;
    this.statsTimer -= dt;
    this.boardTimer -= dt;
    this.minimapTimer -= dt;
    if (this.statsTimer <= 0) {
      this.statsTimer = 0.25;
      const room = this.net?.room.code ?? null;
      this.hud.setStats(
        this.fps,
        me.score,
        world.rankOf(me.id),
        world.snakes.size,
        this.kills,
        room,
      );
    }
    if (this.boardTimer <= 0) {
      this.boardTimer = 1;
      const top = world.getLeaderboard(10);
      const rows = top.map((s, i) => ({ rank: i + 1, name: s.name, score: s.score, me: s === me }));
      if (!top.includes(me)) {
        rows.push({ rank: world.rankOf(me.id), name: me.name, score: me.score, me: true });
      }
      this.hud.setLeaderboard(rows);
    }
    if (this.minimapTimer <= 0) {
      // Birincinin halkası nabız gibi atsın diye sık çizilir
      this.minimapTimer = 0.1;
      const R = world.cfg.arenaRadius;
      const top = world.getLeaderboard(10);
      const entries: MinimapSnake[] = top.map((s, i) => {
        const rank = i + 1;
        const own = s === me;
        return { x: s.x, y: s.y, rank, me: own, path: own || rank <= 3 ? ropePath(s, R) : [] };
      });
      if (!top.includes(me)) {
        entries.push({
          x: me.x,
          y: me.y,
          rank: world.rankOf(me.id),
          me: true,
          path: ropePath(me, R),
        });
      }
      this.hud.drawMinimap(R, entries);
    }
  }

  private countFps(dt: number): void {
    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 1) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
    }
  }
}

const ROPE_POINT = { x: 0, y: 0 };

/**
 * Mini haritada ip gibi çizilecek gövde: kafadan kuyruğa örnekler (x, y çiftleri). Örnek aralığı
 * haritada ~1.5 piksele denk gelir; en fazla 120 nokta.
 */
function ropePath(s: SnakeLike, arenaRadius: number): number[] {
  const step = Math.max(arenaRadius / 150, s.length / 120);
  const out: number[] = [];
  for (let arc = step; arc < s.length + step; arc += step) {
    s.body.pointAt(s.x, s.y, Math.min(arc, s.length), ROPE_POINT);
    out.push(ROPE_POINT.x, ROPE_POINT.y);
  }
  return out;
}
