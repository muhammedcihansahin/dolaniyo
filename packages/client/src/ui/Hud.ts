import { onLangChange, t } from '../i18n';
import { storage } from '../storage';

export interface LeaderboardRow {
  rank: number;
  name: string;
  score: number;
  me: boolean;
}

/** Mini haritadaki bir yılan. */
export interface MinimapSnake {
  x: number;
  y: number;
  /** Gövde boyunca örnekler (x, y çiftleri, kafadan kuyruğa); ip gibi çizilir. Boşsa nokta. */
  path: number[];
  /** Skor tablosundaki sırası (1 = birinci). */
  rank: number;
  me: boolean;
}

/** Mini harita boyları (CSS'te `.mm-size-N`): küçük, orta (varsayılan), büyük. */
const MINIMAP_SIZES = 3;
const MINIMAP_DEFAULT_SIZE = 1;
/** Fare haritaya bu kadar (piksel) yaklaşınca +/− düğmeleri görünür. */
const MINIMAP_NEAR_PX = 70;

/** İlk üçün renkleri: altın, gümüş, bronz. */
const PODIUM = ['#ffd23f', '#dfe7f5', '#f0a165'];
const ME_COLOR = '#ffffff';

/**
 * Oyun içi göstergeler: skor tablosu (sağ üst), istatistikler ve mini harita (yerleşim CSS'te;
 * dokunmatikte hızlanma düğmesine yer açmak için değişir), menüye dön düğmesi (sol üst).
 */
export class Hud {
  private readonly root = document.getElementById('hud')!;
  private readonly board = document.getElementById('leaderboard')!;
  private readonly stats = document.getElementById('stats')!;
  private readonly minimap = document.getElementById('minimap') as HTMLCanvasElement;
  private readonly mm = this.minimap.getContext('2d')!;
  private readonly mmBox = document.getElementById('minimap-box')!;
  private readonly mmPlus = document.getElementById('mm-plus') as HTMLButtonElement;
  private readonly mmMinus = document.getElementById('mm-minus') as HTMLButtonElement;
  private mmSize = MINIMAP_DEFAULT_SIZE;
  private readonly toast = document.getElementById('hud-toast')!;
  private readonly exitBtn = document.getElementById('exit-btn') as HTMLButtonElement;
  private readonly boostBtn = document.getElementById('boost-btn')!;
  private toastTimer = 0;

  /** `exit`: sol üstteki "menüye dön" düğmesi (dokunmatikte Esc'in yerini tutar). */
  constructor(exit: () => void) {
    this.exitBtn.addEventListener('click', () => {
      this.exitBtn.blur();
      exit();
    });
    const saved = Number(storage.get('minimapSize') ?? MINIMAP_DEFAULT_SIZE);
    this.setMinimapSize(Number.isInteger(saved) ? saved : MINIMAP_DEFAULT_SIZE);
    for (const [btn, step] of [
      [this.mmPlus, 1],
      [this.mmMinus, -1],
    ] as const) {
      // Tıklama hızlanma sayılmasın, odak düğmede kalıp Space'i yutmasın
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', () => {
        btn.blur();
        this.setMinimapSize(this.mmSize + step);
      });
    }
    // Fare haritanın yanına gelince +/− düğmeleri belirir (harita fareyi engellemez,
    // üzerindeyken de yön ve hızlanma çalışır)
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || this.root.hidden) return;
      const r = this.mmBox.getBoundingClientRect();
      const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
      const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
      this.mmBox.classList.toggle('near', Math.hypot(dx, dy) < MINIMAP_NEAR_PX);
    });

    onLangChange(() => {
      this.mmPlus.title = t('hud.mapBigger');
      this.mmPlus.setAttribute('aria-label', t('hud.mapBigger'));
      this.mmMinus.title = t('hud.mapSmaller');
      this.mmMinus.setAttribute('aria-label', t('hud.mapSmaller'));
      this.exitBtn.title = t('hud.exit');
      this.exitBtn.setAttribute('aria-label', t('hud.exit'));
      this.boostBtn.setAttribute('aria-label', t('hud.boost'));
    });
  }

  show(visible: boolean): void {
    this.root.hidden = !visible;
    if (!visible) this.mmBox.classList.remove('near');
  }

  /** 0 = küçük, 1 = orta, 2 = büyük. */
  private setMinimapSize(size: number): void {
    this.mmSize = Math.min(MINIMAP_SIZES - 1, Math.max(0, size));
    for (let i = 0; i < MINIMAP_SIZES; i++) {
      this.mmBox.classList.toggle(`mm-size-${i}`, i === this.mmSize);
    }
    this.mmPlus.disabled = this.mmSize === MINIMAP_SIZES - 1;
    this.mmMinus.disabled = this.mmSize === 0;
    storage.set('minimapSize', String(this.mmSize));
  }

  /** Ekranın alt ortasında kısa süre görünen bildirim (ör. oyun hızı değişti). */
  flash(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add('visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('visible'), 1400);
  }

  setLeaderboard(rows: LeaderboardRow[]): void {
    this.board.replaceChildren(
      ...rows.map((r) => {
        const row = document.createElement('div');
        row.className = r.me ? 'lb-row me' : 'lb-row';
        const name = document.createElement('span');
        name.className = 'lb-name';
        name.textContent = `${r.rank}. ${r.name}`;
        const score = document.createElement('span');
        score.className = 'lb-score';
        score.textContent = String(Math.floor(r.score));
        row.append(name, score);
        return row;
      }),
    );
  }

  /** `room`: odadaysa oda kodu. */
  setStats(
    fps: number,
    score: number,
    rank: number,
    total: number,
    kills: number,
    room: string | null,
  ): void {
    const lines = [
      `${t('hud.fps')}: ${fps}`,
      `${t('hud.score')}: ${Math.floor(score)}`,
      `${t('hud.rank')}: ${t('hud.rankOf', { rank, total })}`,
      `${t('hud.kills')}: ${kills}`,
    ];
    if (room) lines.push(`${t('hud.room')}: ${room}`);
    this.stats.replaceChildren(
      ...lines.map((text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div;
      }),
    );
  }

  /**
   * Koordinatlar arena merkezine göre, `arenaRadius` ile normalize edilir. İlk üç ve oyuncunun
   * kendisi gövdeleri boyunca ip gibi, başlarında sıra numarasıyla çizilir; diğerleri nokta.
   */
  drawMinimap(arenaRadius: number, snakes: readonly MinimapSnake[]): void {
    const c = this.minimap;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = c.clientWidth;
    if (size <= 0) return;
    if (c.width !== Math.round(size * dpr)) {
      c.width = c.height = Math.round(size * dpr);
    }
    const ctx = this.mm;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const m = size / 2;
    const scale = (m - 4) / arenaRadius;
    const px = (v: number) => m + v * scale;
    // Büyük haritada çizgiler ve yazılar da biraz büyür
    const k = Math.min(1.6, Math.max(0.8, size / 220));

    ctx.fillStyle = 'rgba(8, 18, 42, 0.8)';
    ctx.beginPath();
    ctx.arc(m, m, m - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(111, 182, 255, 0.85)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    const roped = (s: MinimapSnake) => s.me || s.rank <= 3;
    ctx.fillStyle = 'rgba(160, 190, 240, 0.5)';
    for (const s of snakes) {
      if (roped(s)) continue;
      ctx.beginPath();
      ctx.arc(px(s.x), px(s.y), 2 * k, 0, Math.PI * 2);
      ctx.fill();
    }

    // Önce 3., en son 1. ve oyuncu: üst üste binince öndekiler görünsün
    const ropes = snakes.filter(roped).sort((a, b) => (a.me ? 1 : b.me ? -1 : b.rank - a.rank));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of ropes) {
      const color = s.me ? ME_COLOR : PODIUM[s.rank - 1]!;
      if (s.path.length >= 4) {
        ctx.beginPath();
        ctx.moveTo(px(s.x), px(s.y));
        for (let i = 0; i < s.path.length; i += 2) ctx.lineTo(px(s.path[i]!), px(s.path[i + 1]!));
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.lineWidth = 4.2 * k;
        ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2 * k;
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px(s.x), px(s.y), 3 * k, 0, Math.PI * 2);
      ctx.fill();
    }

    // Birincinin başında nabız gibi atan halka
    const leader = snakes.find((s) => s.rank === 1);
    if (leader) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
      ctx.strokeStyle = `rgba(255, 210, 63, ${0.45 + 0.4 * pulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px(leader.x), px(leader.y), (6 + 2 * pulse) * k, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Sıra rozetleri (1, 2, 3): başın hemen üstünde, harita dışına taşmadan
    const badge = 6.5 * k;
    ctx.font = `700 ${Math.round(9 * k)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of ropes) {
      if (s.rank > 3) continue;
      const bx = Math.min(size - badge - 1, Math.max(badge + 1, px(s.x)));
      const by = Math.min(size - badge - 1, Math.max(badge + 1, px(s.y) - badge - 4 * k));
      ctx.fillStyle = PODIUM[s.rank - 1]!;
      ctx.beginPath();
      ctx.arc(bx, by, badge, 0, Math.PI * 2);
      ctx.fill();
      if (s.me) {
        ctx.strokeStyle = ME_COLOR;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = '#0a1633';
      ctx.fillText(String(s.rank), bx, by + 0.5);
    }
  }
}
