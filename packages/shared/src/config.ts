/**
 * Tüm oynanış sabitleri tek yerde. Değerler CURRENT_PLAN.md §7'deki başlangıç değerleridir;
 * oynayarak ayarlanacak. Birim: "u" (dünya birimi), süre saniye, tick = 1/TICK_RATE sn.
 */

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

export interface SimConfig {
  arenaRadius: number;
  /** Gövde noktaları arası sabit mesafe. */
  segmentSpacing: number;

  /** length(score) = lenBase + lenK * score^lenExp */
  lenBase: number;
  lenK: number;
  lenExp: number;
  /** radius(score) = rBase + rK * log2(1 + score/10) — üst sınır yok, büyüme sınırsız. */
  rBase: number;
  rK: number;

  baseSpeed: number;
  boostSpeed: number;
  /** speed /= (1 + r / sizeSlowdown) */
  sizeSlowdown: number;
  /** rad/sn, r = rBase iken; büyüdükçe sqrt(rBase / r) ile azalır. */
  turnRateBase: number;

  startScore: number;

  boostMinScore: number;
  /** Saniyedeki skor kaybı = boostDrainBase + score * boostDrainK */
  boostDrainBase: number;
  boostDrainK: number;
  /** Kaybedilen skorun yem olarak düşen oranı. */
  boostDropRatio: number;
  /** Tek boost yeminin değeri = clamp(score * boostDropUnitK, boostDropUnitMin, boostDropUnitMax). */
  boostDropUnitK: number;
  boostDropUnitMin: number;
  boostDropUnitMax: number;
  boostFoodLifeTicks: number;

  /** Ortam yemi yoğunluğu: u² başına yem. */
  foodDensity: number;
  ambientValueMin: number;
  ambientValueMax: number;
  /** Bir tick'te en fazla kaç ortam yemi yenilenir. */
  ambientRefillPerTick: number;
  /** Yenen ortam yemi, yendiği yerden bu kadar uzakta yeniden doğar (bölge hiç boşalmaz). */
  ambientRespawnMin: number;
  ambientRespawnMax: number;

  deathDropRatio: number;
  /** Ölüm yemleri gövde boyunca her `r * deathOrbSpacing` birimde bir dizilir. */
  deathOrbSpacing: number;
  /** Ölüm yemi yarıçapı = r * [deathOrbSizeMin, deathOrbSizeMax] (değerden bağımsız). */
  deathOrbSizeMin: number;
  deathOrbSizeMax: number;
  deathOrbMaxCount: number;
  deathFoodLifeTicks: number;

  /** Mıknatıs yarıçapı = r * magnetK + magnetBase */
  magnetK: number;
  magnetBase: number;
  magnetSpeed: number;

  /** Kafa çarpışma dairesi = r * headHitScale */
  headHitScale: number;
  /** Kafadan itibaren headZoneK * r uzunluğundaki kısım "kafa bölgesi" sayılır. */
  headZoneK: number;
  /** Kafa-kafa çarpışmada bu oran kadar büyük olan hayatta kalır. */
  bigWinRatio: number;

  spawnRadiusFrac: number;
  spawnMinSnakeDist: number;
  spawnMinBorderDist: number;
  spawnTries: number;

  gridCellSize: number;
}

export const DEFAULT_SIM_CONFIG: Readonly<SimConfig> = {
  arenaRadius: 6000,
  segmentSpacing: 6,

  lenBase: 120,
  lenK: 14,
  lenExp: 0.6,
  rBase: 12,
  rK: 2.4,

  baseSpeed: 230,
  boostSpeed: 460,
  sizeSlowdown: 400,
  turnRateBase: 4.2,

  startScore: 10,

  boostMinScore: 12,
  boostDrainBase: 4,
  boostDrainK: 0.008,
  boostDropRatio: 0.4,
  boostDropUnitK: 0.002,
  boostDropUnitMin: 1.5,
  boostDropUnitMax: 6,
  boostFoodLifeTicks: 30 * TICK_RATE,

  foodDensity: 1 / 30000,
  ambientValueMin: 1,
  ambientValueMax: 3,
  ambientRefillPerTick: 64,
  ambientRespawnMin: 500,
  ambientRespawnMax: 1600,

  deathDropRatio: 0.8,
  deathOrbSpacing: 0.5,
  deathOrbSizeMin: 0.7,
  deathOrbSizeMax: 0.95,
  deathOrbMaxCount: 1200,
  deathFoodLifeTicks: 90 * TICK_RATE,

  magnetK: 3,
  magnetBase: 40,
  magnetSpeed: 600,

  headHitScale: 0.9,
  headZoneK: 1,
  bigWinRatio: 2,

  spawnRadiusFrac: 0.75,
  spawnMinSnakeDist: 600,
  spawnMinBorderDist: 800,
  spawnTries: 30,

  gridCellSize: 128,
};

export function makeConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { ...DEFAULT_SIM_CONFIG, ...overrides };
}

export function lengthForScore(cfg: SimConfig, score: number): number {
  return cfg.lenBase + cfg.lenK * Math.pow(Math.max(0, score), cfg.lenExp);
}

export function radiusForScore(cfg: SimConfig, score: number): number {
  return cfg.rBase + cfg.rK * Math.log2(1 + Math.max(0, score) / 10);
}

export function speedFor(cfg: SimConfig, radius: number, boosting: boolean): number {
  return (boosting ? cfg.boostSpeed : cfg.baseSpeed) / (1 + radius / cfg.sizeSlowdown);
}

export function turnRateFor(cfg: SimConfig, radius: number): number {
  return cfg.turnRateBase * Math.sqrt(cfg.rBase / radius);
}

export function magnetRadius(cfg: SimConfig, radius: number): number {
  return radius * cfg.magnetK + cfg.magnetBase;
}

export function foodRadius(value: number): number {
  return 3 + 2.6 * Math.sqrt(value);
}

/** Gövde, çizim/çarpışma için gereken uzunluğun biraz fazlasını tutar (interpolasyon payı). */
export function bodyTrimMargin(cfg: SimConfig): number {
  return cfg.boostSpeed * DT + cfg.segmentSpacing * 2;
}
