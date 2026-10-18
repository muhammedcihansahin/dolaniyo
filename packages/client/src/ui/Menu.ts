import {
  MAX_BOTS,
  NICK_MAX_CHARS,
  ROOM_MAX_CHARS,
  SPEED_SCALE_MAX,
  SPEED_SCALE_MIN,
  clampBotCount,
  clampSpeedScale,
} from '@yilan/shared';
import { onLangChange, t, type MessageKey } from '../i18n';
import { isTouch, onTouchChange } from '../input/device';
import type { RoomInfo } from '../net/NetGame';
import { storage } from '../storage';

const LOGO_WORDS = ['Yılan', 'Dolan', 'Cihan'];

const DESKTOP_TIPS: MessageKey[] = [
  'menu.tip.boost',
  'menu.tip.steer',
  'menu.tip.rooms',
  'menu.tip.avoid',
  'menu.tip.cost',
  'menu.tip.keys',
  'menu.tip.escape',
  'menu.tip.speedKeys',
  'menu.tip.fullscreen',
];
const TOUCH_TIPS: MessageKey[] = [
  'menu.tip.touchSteer',
  'menu.tip.touchBoost',
  'menu.tip.rooms',
  'menu.tip.avoid',
  'menu.tip.cost',
  'menu.tip.touchExit',
  'menu.tip.fullscreen',
];
const TIP_INTERVAL_MS = 5000;
export const DEFAULT_BOTS = 20;

export interface MenuHandlers {
  play(nickInput: string): void;
  /** Bot sürgüsü değişti (çevrimdışı oyuna anında uygulanır, oda kurarken de kullanılır). */
  botsChanged(count: number): void;
  /** Oyun hızı sürgüsü değişti (çarpan, 1 = varsayılan); bot sürgüsü gibi uygulanır. */
  speedChanged(scale: number): void;
  createRoom(bots: number, speed: number): void;
  /** Kullanıcının yazdığı ham kod; doğrulama çağıranda. */
  joinRoom(rawCode: string): void;
  leaveRoom(): void;
}

/** Ana menü: logo, takma ad + Oyna, bot sayısı, oda kur/katıl veya odadaysa oda bilgisi. */
export class Menu {
  private readonly root = document.getElementById('menu')!;
  private readonly form = document.getElementById('play-form') as HTMLFormElement;
  private readonly nick = document.getElementById('nick') as HTMLInputElement;
  private readonly playBtn = document.getElementById('play-btn') as HTMLButtonElement;
  private readonly tip = document.getElementById('tip')!;
  private readonly logoMain = document.querySelector('#menu .logo-main')!;
  private readonly lastScore = document.getElementById('last-score')!;
  private readonly status = document.getElementById('menu-status')!;

  private readonly setupPanel = document.getElementById('setup-panel')!;
  private readonly bots = document.getElementById('bots') as HTMLInputElement;
  private readonly botsValue = document.getElementById('bots-value')!;
  private readonly speed = document.getElementById('speed') as HTMLInputElement;
  private readonly speedValue = document.getElementById('speed-value')!;
  private readonly createBtn = document.getElementById('room-create') as HTMLButtonElement;
  private readonly joinForm = document.getElementById('join-form') as HTMLFormElement;
  private readonly codeInput = document.getElementById('room-code-input') as HTMLInputElement;
  private readonly joinBtn = document.getElementById('join-btn') as HTMLButtonElement;

  private readonly roomPanel = document.getElementById('room-panel')!;
  private readonly roomCode = document.getElementById('room-code')!;
  private readonly roomMeta = document.getElementById('room-meta')!;
  private readonly roomLink = document.getElementById('room-link') as HTMLInputElement;
  private readonly copyBtn = document.getElementById('room-copy') as HTMLButtonElement;
  private readonly leaveBtn = document.getElementById('room-leave') as HTMLButtonElement;

  private tips = DESKTOP_TIPS;
  private tipIndex = 0;
  private tipTimer = 0;
  private copiedTimer = 0;
  private lastScoreValue: number | null = null;
  private room: RoomInfo | null = null;
  private statusKey: MessageKey | null = null;
  private statusIsError = false;

  constructor(handlers: MenuHandlers) {
    this.nick.maxLength = NICK_MAX_CHARS + 1 + ROOM_MAX_CHARS;
    this.nick.value = storage.get('nick') ?? '';
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      storage.set('nick', this.nick.value);
      handlers.play(this.nick.value);
    });

    this.bots.max = String(MAX_BOTS);
    const saved = Number(storage.get('bots') ?? DEFAULT_BOTS);
    this.bots.value = String(clampBotCount(Number.isFinite(saved) ? saved : DEFAULT_BOTS));
    this.botsValue.textContent = this.bots.value;
    this.bots.addEventListener('input', () => {
      this.botsValue.textContent = this.bots.value;
      storage.set('bots', this.bots.value);
      handlers.botsChanged(this.botCount);
    });

    // Sürgü yüzde cinsinden: 100 = varsayılan hız
    this.speed.min = String(Math.round(SPEED_SCALE_MIN * 100));
    this.speed.max = String(Math.round(SPEED_SCALE_MAX * 100));
    const savedSpeed = Number(storage.get('speed') ?? 100);
    this.speed.value = String(Math.round(clampSpeedScale(savedSpeed / 100) * 100));
    this.speed.addEventListener('input', () => {
      this.renderSpeed();
      storage.set('speed', this.speed.value);
      handlers.speedChanged(this.speedScale);
    });

    this.createBtn.addEventListener('click', () =>
      handlers.createRoom(this.botCount, this.speedScale),
    );
    this.joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handlers.joinRoom(this.codeInput.value);
    });
    this.leaveBtn.addEventListener('click', () => handlers.leaveRoom());
    this.copyBtn.addEventListener('click', () => this.copyLink());
    this.roomLink.addEventListener('focus', () => this.roomLink.select());

    onLangChange(() => {
      this.nick.placeholder = t('menu.nickPlaceholder');
      this.playBtn.textContent = t('menu.play');
      document.getElementById('settings-title')!.textContent = t('menu.settings');
      document.getElementById('bots-label')!.textContent = t('menu.bots');
      document.getElementById('speed-label')!.textContent = t('menu.speed');
      this.renderSpeed();
      document.getElementById('friends-title')!.textContent = t('menu.friends');
      document.getElementById('room-label')!.textContent = t('menu.room');
      this.createBtn.textContent = t('menu.createRoom');
      this.codeInput.placeholder = t('menu.roomCodePlaceholder');
      this.joinBtn.textContent = t('menu.joinRoom');
      this.copyBtn.textContent = t('menu.copyLink');
      this.leaveBtn.textContent = t('menu.leaveRoom');
      document.title = t('doc.title');
      this.renderTip();
      this.renderLastScore();
      this.renderRoom();
      this.renderStatus();
    });
    onTouchChange((touch) => {
      const tips = touch ? TOUCH_TIPS : DESKTOP_TIPS;
      // Tam ekran ipucu yalnızca düğme varsa (iPhone Safari'de yok)
      this.tips = document.getElementById('fs-btn')!.hidden
        ? tips.filter((k) => k !== 'menu.tip.fullscreen')
        : tips;
      this.tipIndex = 0;
      this.renderTip();
    });
  }

  get botCount(): number {
    return clampBotCount(Number(this.bots.value));
  }

  get speedScale(): number {
    return clampSpeedScale(Number(this.speed.value) / 100);
  }

  /** Oyun içinde tuşla değişen hız sürgüye ve kayıtlı ayara da yansır. */
  setSpeedScale(v: number): void {
    this.speed.value = String(Math.round(clampSpeedScale(v) * 100));
    storage.set('speed', this.speed.value);
    this.renderSpeed();
  }

  show(lastScore: number | null): void {
    // Şakacı logo: menü her açıldığında rastgele biri
    this.logoMain.textContent = LOGO_WORDS[Math.floor(Math.random() * LOGO_WORDS.length)]!;
    this.lastScoreValue = lastScore;
    this.renderLastScore();
    this.root.hidden = false;
    this.root.classList.remove('fade-out');
    // Dokunmatikte odaklamak sanal klavyeyi açıp menüyü kapatırdı
    if (!isTouch()) this.nick.focus({ preventScroll: true });
    window.clearInterval(this.tipTimer);
    this.tipTimer = window.setInterval(() => {
      this.tipIndex = (this.tipIndex + 1) % this.tips.length;
      this.renderTip();
    }, TIP_INTERVAL_MS);
  }

  hide(): void {
    window.clearInterval(this.tipTimer);
    this.nick.blur();
    this.root.hidden = true;
  }

  /** Odadaysa oda bilgisini, değilse bot ayarı + oda kur/katıl panelini gösterir. */
  setRoom(room: RoomInfo | null): void {
    this.room = room;
    this.renderRoom();
  }

  /** Bağlanırken düğmeleri kilitler. */
  setBusy(busy: boolean): void {
    for (const el of [this.createBtn, this.joinBtn, this.playBtn, this.leaveBtn])
      el.disabled = busy;
    this.codeInput.disabled = busy;
    if (busy) this.setStatus('menu.connecting', false);
  }

  setStatus(key: MessageKey | null, isError = true): void {
    this.statusKey = key;
    this.statusIsError = isError;
    this.renderStatus();
  }

  private renderRoom(): void {
    const room = this.room;
    this.setupPanel.hidden = room !== null;
    this.roomPanel.hidden = room === null;
    if (!room) return;
    this.roomCode.textContent = room.code;
    this.roomMeta.textContent = t('menu.roomMeta', {
      people: room.people,
      bots: room.bots,
      speed: Math.round(room.speed * 100),
    });
    this.roomLink.value = roomLink(room);
    document.getElementById('room-hint')!.textContent = t(
      room.hosting ? 'menu.roomHintHost' : 'menu.roomHint',
    );
  }

  private renderSpeed(): void {
    this.speedValue.textContent = t('menu.percent', { value: this.speed.value });
  }

  private renderStatus(): void {
    this.status.textContent = this.statusKey ? t(this.statusKey) : '';
    this.status.classList.toggle('error', this.statusIsError);
  }

  private async copyLink(): Promise<void> {
    const text = this.roomLink.value;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Panoya yazma yalnızca güvenli bağlamda (https/localhost) var; eski yönteme düş
      this.roomLink.focus();
      this.roomLink.select();
      ok = document.execCommand('copy');
    }
    if (!ok) return;
    this.copyBtn.textContent = t('menu.copied');
    window.clearTimeout(this.copiedTimer);
    this.copiedTimer = window.setTimeout(() => {
      this.copyBtn.textContent = t('menu.copyLink');
    }, 1500);
  }

  private renderTip(): void {
    this.tip.classList.remove('tip-in');
    void this.tip.offsetWidth; // animasyonu yeniden başlat
    this.tip.textContent = t(this.tips[this.tipIndex]!);
    this.tip.classList.add('tip-in');
  }

  private renderLastScore(): void {
    const v = this.lastScoreValue;
    this.lastScore.textContent = v !== null ? t('menu.lastScore', { score: v }) : '';
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Arkadaşlara gönderilecek bağlantı. Oyun bu bilgisayarda localhost'tan açıldıysa,
 * arkadaşların ulaşabilmesi için sunucunun yerel ağ adresi kullanılır.
 */
export function roomLink(room: RoomInfo): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('oda', room.code);
  if (LOCAL_HOSTS.has(url.hostname) && room.lan[0]) url.hostname = room.lan[0];
  return url.toString();
}
