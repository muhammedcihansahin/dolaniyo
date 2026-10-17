import { BotController, World, type DeathReason, type SimEvent, type Snake } from '@yilan/shared';

export interface PlayerDeath {
  score: number;
  reason: DeathReason;
  killerName: string | null;
}

/**
 * Sunucusuz oyun: ortak simülasyonu tarayıcıda botlarla çalıştırır.
 * Faz 4'te aynı arayüzü sunan bir ağ istemcisi (NetClient) eklenecek.
 */
export class OfflineGame {
  readonly world: World;
  onPlayerDied: ((death: PlayerDeath) => void) | null = null;
  /** Bu tick'te oluşan olaylar (çizim efektleri için). */
  lastEvents: SimEvent[] = [];

  private readonly bots: BotController;
  private playerId = 0;

  constructor(seed = (Math.random() * 2 ** 32) >>> 0) {
    this.world = new World({ arenaRadius: 5000 }, seed);
    this.bots = new BotController(this.world, {
      targetPopulation: 24,
      randomInitialScores: true,
    });
  }

  get player(): Snake | null {
    return this.playerId ? (this.world.snakes.get(this.playerId) ?? null) : null;
  }

  join(name: string, color: number): Snake {
    this.leave();
    const s = this.world.addSnake({ name, color });
    this.playerId = s.id;
    return s;
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

  step(): void {
    this.bots.update();
    this.world.step();
    this.lastEvents = this.world.drainEvents();
    for (const e of this.lastEvents) {
      if (e.type !== 'died' || e.id !== this.playerId) continue;
      this.playerId = 0;
      const killer = e.killerId ? this.world.snakes.get(e.killerId) : undefined;
      this.onPlayerDied?.({ score: e.score, reason: e.reason, killerName: killer?.name ?? null });
    }
  }
}
