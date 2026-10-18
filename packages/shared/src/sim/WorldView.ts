import type { SimConfig } from '../config';
import type { FoodStore } from './FoodStore';
import type { SnakeLike } from './Snake';

/**
 * Çizim ve arayüzün okuduğu dünya: çevrimdışı modda simülasyonun kendisi (`World`),
 * odada ise sunucudan gelen durumun aynası (`WorldMirror`).
 */
export interface WorldView {
  readonly cfg: SimConfig;
  readonly food: FoodStore;
  readonly snakes: ReadonlyMap<number, SnakeLike>;
  readonly snakeList: readonly SnakeLike[];
  readonly tick: number;
  /** Skora göre sıralı ilk `n` yılan. */
  getLeaderboard(n: number): SnakeLike[];
  /** 1'den başlayan sıra; yılan yoksa 0. */
  rankOf(id: number): number;
}
