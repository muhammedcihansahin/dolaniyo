import { NICK_MAX_CHARS, ROOM_MAX_CHARS } from '@yilan/shared';
import { onLangChange, t, type MessageKey } from '../i18n';
import { storage } from '../storage';

const TIPS: MessageKey[] = [
  'menu.tip.boost',
  'menu.tip.steer',
  'menu.tip.avoid',
  'menu.tip.cost',
  'menu.tip.keys',
  'menu.tip.escape',
];
const TIP_INTERVAL_MS = 5000;

/** Ana menü (Faz 1 sürümü): logo, takma ad, Oyna, dönen ipuçları, son skor. */
export class Menu {
  private readonly root = document.getElementById('menu')!;
  private readonly form = document.getElementById('play-form') as HTMLFormElement;
  private readonly nick = document.getElementById('nick') as HTMLInputElement;
  private readonly playBtn = document.getElementById('play-btn')!;
  private readonly tip = document.getElementById('tip')!;
  private readonly lastScore = document.getElementById('last-score')!;
  private tipIndex = 0;
  private tipTimer = 0;
  private lastScoreValue: number | null = null;

  constructor(onPlay: (nickInput: string) => void) {
    this.nick.maxLength = NICK_MAX_CHARS + 1 + ROOM_MAX_CHARS;
    this.nick.value = storage.get('nick') ?? '';
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      storage.set('nick', this.nick.value);
      onPlay(this.nick.value);
    });
    onLangChange(() => {
      this.nick.placeholder = t('menu.nickPlaceholder');
      this.playBtn.textContent = t('menu.play');
      document.title = t('doc.title');
      this.renderTip();
      this.renderLastScore();
    });
  }

  show(lastScore: number | null): void {
    this.lastScoreValue = lastScore;
    this.renderLastScore();
    this.root.hidden = false;
    this.root.classList.remove('fade-out');
    this.nick.focus({ preventScroll: true });
    window.clearInterval(this.tipTimer);
    this.tipTimer = window.setInterval(() => {
      this.tipIndex = (this.tipIndex + 1) % TIPS.length;
      this.renderTip();
    }, TIP_INTERVAL_MS);
  }

  hide(): void {
    window.clearInterval(this.tipTimer);
    this.nick.blur();
    this.root.hidden = true;
  }

  private renderTip(): void {
    this.tip.classList.remove('tip-in');
    void this.tip.offsetWidth; // animasyonu yeniden başlat
    this.tip.textContent = t(TIPS[this.tipIndex]!);
    this.tip.classList.add('tip-in');
  }

  private renderLastScore(): void {
    const v = this.lastScoreValue;
    this.lastScore.textContent = v !== null ? t('menu.lastScore', { score: v }) : '';
  }
}
