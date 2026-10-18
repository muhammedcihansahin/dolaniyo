import {
  BotController,
  World,
  changeSpeedScale,
  type SimEvent,
  type Snake,
  type SpeedChange,
} from '@yilan/shared';
import type { GameSession, PlayerDeath } from '../game/GameSession';

/** Odalarla aynı arena boyutu: botlu tek kişilik oyun ile oda aynı hissi versin. */
export const ARENA_RADIUS = 20000;

/** Sunucusuz oyun: ortak simülasyonu tarayıcıda botlarla çalıştırır. */
export class OfflineGame implements GameSession {
  readonly world: World;
  onPlayerDied: ((death: PlayerDeath) => void) | null = null;
  onSpeedChanged: ((speed: number | null) => void) | null = null;
  lastEvents: SimEvent[] = [];

  private readonly bots: BotController;
  private playerId = 0;

  constructor(botCount: number, speedScale = 1, seed = (Math.random() * 2 ** 32) >>> 0) {
    this.world = new World({ arenaRadius: ARENA_RADIUS, speedScale }, seed);
    this.bots = new BotController(this.world, { botCount, randomInitialScores: true });
  }

  get player(): Snake | null {
    return this.playerId ? (this.world.snakes.get(this.playerId) ?? null) : null;
  }

  setBotCount(n: number): void {
    this.bots.setBotCount(n);
  }

  setSpeedScale(v: number): void {
    this.world.setSpeedScale(v);
  }

  /** Tüm diğer yılanlar bot: hız her zaman değiştirilebilir. */
  changeSpeed(change: SpeedChange): void {
    this.world.setSpeedScale(changeSpeedScale(this.world.cfg.speedScale, change));
    this.onSpeedChanged?.(this.world.cfg.speedScale);
  }

  join(name: string, color: number): void {
    this.leave();
    this.playerId = this.world.addSnake({ name, color }).id;
  }

  leave(): void {
    if (!this.playerId) return;
    const id = this.playerId;
    this.playerId = 0;
    this.world.removeSnake(id);
  }

  setInput(angle: number, boost: boolean): void {
    if (this.playerId) this.world.setInput(this.playerId, angle, boost);
  }

  step(): boolean {
    this.bots.update();
    this.world.step();
    this.lastEvents = this.world.drainEvents();
    for (const e of this.lastEvents) {
      if (e.type !== 'died' || e.id !== this.playerId) continue;
      this.playerId = 0;
      const killer = e.killerId ? this.world.snakes.get(e.killerId) : undefined;
      this.onPlayerDied?.({ score: e.score, reason: e.reason, killerName: killer?.name ?? null });
    }
    return true;
  }
}
