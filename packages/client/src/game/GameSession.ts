import type { DeathReason, SimEvent, SnakeLike, SpeedChange, WorldView } from '@yilan/shared';

export interface PlayerDeath {
  score: number;
  reason: DeathReason;
  killerName: string | null;
}

/**
 * Oyun kodunun konuştuğu oturum: çevrimdışı (botlarla, tarayıcıda) veya bir oda (sunucuda).
 * GameApp ikisini ayırt etmeden kullanır.
 */
export interface GameSession {
  readonly world: WorldView;
  /** Oyuncunun canlı yılanı; yoksa (menüde, ölü, henüz doğmamış) null. */
  readonly player: SnakeLike | null;
  /** Son `step()`te oluşan olaylar (çizim efektleri için). */
  readonly lastEvents: readonly SimEvent[];
  onPlayerDied: ((death: PlayerDeath) => void) | null;
  /** Oyun hızı değişti (`speed`), ya da değiştirme izni yok (null). */
  onSpeedChanged: ((speed: number | null) => void) | null;
  /** Oyun hızını bir adım değiştir (çevrimdışı hemen, odada sunucu onaylarsa). */
  changeSpeed(change: SpeedChange): void;
  /** Oyuncu olarak dünyaya gir. */
  join(name: string, color: number): void;
  /** Yılanı bırakıp menüye dön. */
  leave(): void;
  setInput(angle: number, boost: boolean): void;
  /** Bir tick ilerletir; odada henüz yeni tick gelmediyse false döner. */
  step(): boolean;
}
