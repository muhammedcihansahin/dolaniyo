import { DT, SNAKE_COLOR_COUNT, guestName, parseNickInput, type Snake } from '@yilan/shared';
import { Application } from 'pixi.js';
import { Input } from '../input/Input';
import { OfflineGame, type PlayerDeath } from '../offline/OfflineGame';
import { Renderer } from '../render/Renderer';
import { storage } from '../storage';
import { Hud } from '../ui/Hud';
import { Menu } from '../ui/Menu';

type Mode = 'menu' | 'playing' | 'dying';

const MAX_STEPS_PER_FRAME = 4;
const DEATH_TO_MENU_MS = 900;
const SPECTATE_SWITCH_SECONDS = 8;

/** Uygulama durum makinesi: Menü → Oyun → (Ölüm) → Menü. */
export class GameApp {
  private readonly pixi = new Application();
  private game!: OfflineGame;
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

  constructor(private readonly mount: HTMLElement) {}

  async start(): Promise<void> {
    await this.pixi.init({
      resizeTo: window,
      background: 0x0a1633,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 1.5),
      preference: 'webgl',
    });
    this.mount.appendChild(this.pixi.canvas);

    this.game = new OfflineGame();
    this.game.onPlayerDied = (d) => this.onPlayerDied(d);
    this.renderer = new Renderer(this.pixi, this.game.world);
    this.input = new Input(this.pixi.canvas);
    this.input.onEscape = () => this.leaveToMenu();
    this.hud = new Hud();
    this.menu = new Menu((raw) => this.play(raw));
    this.menu.show(null);

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
    if (this.mode === 'playing') return;
    const { nick } = parseNickInput(raw);
    this.game.join(nick ?? guestName(Math.random), this.color);
    this.mode = 'playing';
    this.input.reset();
    this.menu.hide();
    this.hud.show(true);
    this.renderer.startSpawnZoom();
    this.boardTimer = this.statsTimer = this.minimapTimer = 0;
  }

  private onPlayerDied(d: PlayerDeath): void {
    this.mode = 'dying';
    window.setTimeout(() => this.toMenu(Math.floor(d.score)), DEATH_TO_MENU_MS);
  }

  private leaveToMenu(): void {
    if (this.mode !== 'playing') return;
    const score = this.game.player?.score ?? 0;
    this.game.leave();
    this.toMenu(Math.floor(score));
  }

  private toMenu(lastScore: number): void {
    this.mode = 'menu';
    this.hud.show(false);
    this.menu.show(lastScore);
  }

  private frame(deltaMS: number): void {
    const dt = Math.min(deltaMS / 1000, 0.25);
    this.countFps(dt);

    const player = this.game.player;
    if (this.mode === 'playing' && player) {
      const inp = this.input.read(player.angle);
      this.game.setInput(inp.angle, inp.boost);
    }

    this.acc += dt;
    let steps = 0;
    while (this.acc >= DT && steps < MAX_STEPS_PER_FRAME) {
      this.game.step();
      this.renderer.onEvents(this.game.lastEvents);
      this.acc -= DT;
      steps++;
    }
    if (this.acc > DT) this.acc = DT; // yetişemiyorsak geride kalanı at

    const own = this.game.player;
    const focus = own ?? (this.mode === 'menu' ? this.spectateTarget(dt) : null);
    this.renderer.render(this.acc / DT, dt, { snake: focus, own: own !== null }, true);

    if (this.mode === 'playing' && own) this.updateHud(dt, own);
  }

  /** Menüdeyken kamera skor tablosundaki ilk yılanlardan birini izler. */
  private spectateTarget(dt: number): Snake | null {
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

  private updateHud(dt: number, me: Snake): void {
    const world = this.game.world;
    this.statsTimer -= dt;
    this.boardTimer -= dt;
    this.minimapTimer -= dt;
    if (this.statsTimer <= 0) {
      this.statsTimer = 0.25;
      this.hud.setStats(this.fps, me.score, world.rankOf(me.id), world.snakes.size);
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
      this.minimapTimer = 0.2;
      const others = world
        .getLeaderboard(5)
        .filter((s) => s !== me)
        .map((s) => ({ x: s.x, y: s.y, size: 2 + Math.min(3, s.radius / 14) }));
      this.hud.drawMinimap(world.cfg.arenaRadius, { x: me.x, y: me.y, size: 3 }, others);
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
