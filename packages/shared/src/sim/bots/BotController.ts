import { SNAKE_COLOR_COUNT } from '../../colors';
import { TICK_RATE } from '../../config';
import type { World } from '../World';
import { BotBrain, BotStyle } from './BotBrain';
import { BOT_NAMES } from './names';

export interface BotControllerOptions {
  /** Odadaki toplam yılan hedefi (gerçek oyuncu + bot). */
  targetPopulation: number;
  /** İlk doldurmada botlara rastgele başlangıç skoru verilsin mi (oda canlı görünsün). */
  randomInitialScores?: boolean;
  /** Ölen botun yeniden doğma gecikmesi, tick [min, max). */
  respawnDelay?: [number, number];
}

/** Oda nüfusunu botlarla hedefte tutar ve bot zekâlarını çalıştırır. */
export class BotController {
  private readonly brains = new Map<number, BotBrain>();
  private readonly pending: number[] = [];
  private readonly respawnDelay: [number, number];

  constructor(
    private readonly world: World,
    private readonly opts: BotControllerOptions,
  ) {
    this.respawnDelay = opts.respawnDelay ?? [2 * TICK_RATE, 6 * TICK_RATE];
    const need = opts.targetPopulation - world.snakes.size;
    for (let i = 0; i < need; i++) this.spawnBot(opts.randomInitialScores ?? false);
  }

  get botCount(): number {
    return this.brains.size;
  }

  /** Her `world.step()`ten önce çağrılır. */
  update(): void {
    const w = this.world;
    for (const [id, brain] of this.brains) {
      const s = w.snakes.get(id);
      if (!s) {
        this.brains.delete(id);
        continue;
      }
      brain.think(w, s);
    }

    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i]! > w.tick) continue;
      this.pending.splice(i, 1);
      if (w.snakes.size < this.opts.targetPopulation) this.spawnBot(false);
    }

    const deficit = this.opts.targetPopulation - w.snakes.size - this.pending.length;
    for (let i = 0; i < deficit; i++) {
      this.pending.push(w.tick + w.rng.int(this.respawnDelay[0], this.respawnDelay[1]));
    }
  }

  private spawnBot(randomScore: boolean): void {
    const w = this.world;
    const rng = w.rng;
    // Üstel dağılım: çoğu küçük, birkaçı büyük
    const score = randomScore
      ? Math.min(3000, w.cfg.startScore + Math.floor(-Math.log(1 - rng.next()) * 180))
      : undefined;
    const s = w.addSnake({
      name: this.pickName(),
      color: rng.int(0, SNAKE_COLOR_COUNT),
      isBot: true,
      score,
    });
    const roll = rng.next();
    const style =
      roll < 0.2 ? BotStyle.Passive : roll < 0.7 ? BotStyle.Normal : BotStyle.Aggressive;
    this.brains.set(s.id, new BotBrain(s.id, style, rng));
  }

  private pickName(): string {
    const rng = this.world.rng;
    if (rng.chance(0.15)) return `Guest${rng.int(100, 1000)}`;
    const used = new Set<string>();
    for (const s of this.world.snakeList) used.add(s.name);
    for (let t = 0; t < 8; t++) {
      const name = rng.pick(BOT_NAMES);
      if (!used.has(name)) return name;
    }
    return rng.pick(BOT_NAMES);
  }
}
