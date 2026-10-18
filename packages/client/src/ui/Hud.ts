import { onLangChange, t } from '../i18n';

export interface LeaderboardRow {
  rank: number;
  name: string;
  score: number;
  me: boolean;
}

export interface MinimapDot {
  x: number;
  y: number;
  size: number;
}

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
    onLangChange(() => {
      this.exitBtn.title = t('hud.exit');
      this.exitBtn.setAttribute('aria-label', t('hud.exit'));
      this.boostBtn.setAttribute('aria-label', t('hud.boost'));
    });
  }

  show(visible: boolean): void {
    this.root.hidden = !visible;
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
   * Koordinatlar arena merkezine göre, `arenaRadius` ile normalize edilir. `leader`: skor
   * tablosunun birincisi (altın nokta ve halka; birinci oyuncunun kendisiyse onun noktası).
   */
  drawMinimap(
    arenaRadius: number,
    me: MinimapDot | null,
    others: MinimapDot[],
    leader: MinimapDot | null,
  ): void {
    const c = this.minimap;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = c.clientWidth;
    if (c.width !== Math.round(size * dpr)) {
      c.width = c.height = Math.round(size * dpr);
    }
    const ctx = this.mm;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const m = size / 2;
    const scale = (m - 4) / arenaRadius;

    ctx.fillStyle = 'rgba(10, 22, 51, 0.55)';
    ctx.beginPath();
    ctx.arc(m, m, m - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(111, 182, 255, 0.85)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = 'rgba(160, 190, 240, 0.45)';
    for (const o of others) {
      ctx.beginPath();
      ctx.arc(m + o.x * scale, m + o.y * scale, o.size, 0, Math.PI * 2);
      ctx.fill();
    }
    if (leader) {
      const x = m + leader.x * scale;
      const y = m + leader.y * scale;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
      ctx.strokeStyle = `rgba(255, 210, 63, ${0.45 + 0.4 * pulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, leader.size + 3 + 2 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      if (leader !== me) {
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.arc(x, y, leader.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (me) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(m + me.x * scale, m + me.y * scale, me.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
