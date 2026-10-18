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

  /**
   * Büyüme kademeleri (skor eşikleri, artan sırada). Her eşikten sonra kalınlaşma hızı ve boy
   * üssü bir üst kademeye geçer: puan arttıkça büyüme hızlanır, az puanlılar yanında küçük kalır.
   */
  growthTierScores: readonly number[];
  /**
   * length(score) = lenBase + lenK * P(score). P, kademe içinde score^üs gibi büyür ve
   * kademe sınırlarında kesintisizdir; üsler `lenTierExp`te (ilki ilk eşiğin altı için).
   */
  lenBase: number;
  lenK: number;
  lenTierExp: readonly number[];
  /**
   * radius(score) = rBase + rK * ∫ çarpan d(log2(1 + score/10)): skor her ikiye katlandığında
   * yarıçap rK × o kademenin çarpanı kadar artar (`rTierMul`, ilki ilk eşiğin altı için).
   * Üst sınır yok, büyüme sınırsız.
   */
  rBase: number;
  rK: number;
  rTierMul: readonly number[];

  baseSpeed: number;
  boostSpeed: number;
  /** speed /= (1 + r / sizeSlowdown) */
  sizeSlowdown: number;
  /**
   * Oyun hızı çarpanı (ayarlardaki sürgü): normal/boost hızı ve mıknatıs hızı bununla çarpılır.
   * Dönüş dairesi hızdan bağımsız olduğu için dönme kabiliyeti aynı kalır.
   */
  speedScale: number;
  /**
   * En dar dönüş dairesinin yarıçapı = r * turnRadiusK. Açısal hız = hız / bu yarıçap, yani
   * yılan hızlanırken de normalde de aynı daireyi çizer.
   */
  turnRadiusK: number;
  /**
   * Hızlanmaya basınca normal hızdan boost hızına çıkış, bırakınca geri iniş süresi (sn).
   * Hız bu sürede yumuşak bir eğriyle değişir; anında 2,7 kat hızlanıp öne "ışınlanmaz".
   */
  boostRampUpSeconds: number;
  boostRampDownSeconds: number;

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

  /** Ortam yemi yoğunluğu: u² başına yem. */
  foodDensity: number;
  /** Ortam yeminin taban değeri; yemin görünen boyutunu bu belirler. */
  ambientValueMin: number;
  ambientValueMax: number;
  /** Ortam yeminin skora kattığı değer = taban değer × bu çarpan (boyutu değiştirmez). */
  ambientGrowth: number;
  /** Bir tick'te en fazla kaç ortam yemi yenilenir. */
  ambientRefillPerTick: number;
  /** Yenen ortam yemi, yendiği yerden bu kadar uzakta yeniden doğar (bölge hiç boşalmaz). */
  ambientRespawnMin: number;
  ambientRespawnMax: number;

  deathDropRatio: number;
  /** Ölüm yemleri gövde boyunca her `r * deathOrbSpacing` birimde bir dizilir. */
  deathOrbSpacing: number;
  /**
   * Ölüm yemi yarıçapı = r * [deathOrbSizeMin, deathOrbSizeMax] (değerden bağımsız): ölen yılan
   * inceyse ince, kalınsa kalın yem bırakır.
   */
  deathOrbSizeMin: number;
  deathOrbSizeMax: number;
  deathOrbMaxCount: number;
  /**
   * Ölüm yemi düştükten sonra bu kadar tick mıknatısla çekilmez ve yenmez: öldüren yılan
   * baş tarafındaki yemleri anında süpürmesin, kalıntı tüm gövde boyunca görünsün.
   */
  deathFoodSettleTicks: number;

  /**
   * Büyüklük sınırı (yem döngüsü). Yemler normalde hiç kaybolmaz. İlk `foodCapTopN` yılanın
   * toplam skoru `foodCapHigh`a ulaşınca yeni ortam yemi çıkmaz ve var olan/yeni düşen yemler
   * `foodCapFadeMinTicks..MaxTicks` içinde söner; toplam `foodCapLow`a inince her şey normale döner.
   */
  foodCapTopN: number;
  foodCapHigh: number;
  foodCapLow: number;
  foodCapFadeMinTicks: number;
  foodCapFadeMaxTicks: number;
  /**
   * Güvenlik sınırı: ortam dışı (boost/ölüm) yem sayısı bunu aşarsa en eskileri söner.
   * Normal oyunda bu sayıya yaklaşılmaz; yalnızca bellek/ağ yükü sınırsız büyümesin diye.
   */
  looseFoodMax: number;

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
  arenaRadius: 12000,
  segmentSpacing: 6,

  growthTierScores: [50_000, 200_000, 1_000_000],
  lenBase: 120,
  lenK: 14,
  lenTierExp: [0.65, 0.68, 0.72, 0.76],
  rBase: 12,
  rK: 3,
  rTierMul: [0.7, 4, 8, 12],

  baseSpeed: 276,
  boostSpeed: 736,
  sizeSlowdown: 400,
  speedScale: 1,
  turnRadiusK: 2.2,
  boostRampUpSeconds: 0.3,
  boostRampDownSeconds: 0.35,

  startScore: 10,

  boostMinScore: 12,
  boostDrainBase: 2,
  boostDrainK: 0.004,
  boostDropRatio: 0.4,
  boostDropUnitK: 0.002,
  boostDropUnitMin: 1.5,
  boostDropUnitMax: 6,

  foodDensity: 1 / 10000,
  ambientValueMin: 1,
  ambientValueMax: 3,
  ambientGrowth: 6,
  ambientRefillPerTick: 128,
  ambientRespawnMin: 500,
  ambientRespawnMax: 1600,

  deathDropRatio: 1,
  deathOrbSpacing: 0.5,
  deathOrbSizeMin: 1,
  deathOrbSizeMax: 1,
  deathOrbMaxCount: 1200,
  deathFoodSettleTicks: Math.round(0.6 * TICK_RATE),

  foodCapTopN: 15,
  foodCapHigh: 5_000_000,
  foodCapLow: 3_000_000,
  foodCapFadeMinTicks: 10 * TICK_RATE,
  foodCapFadeMaxTicks: 45 * TICK_RATE,
  looseFoodMax: 30_000,

  magnetK: 3,
  magnetBase: 40,
  magnetSpeed: 900,

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
  const s = Math.max(0, score);
  const tiers = cfg.growthTierScores;
  const exps = cfg.lenTierExp;
  // Kademe sınırına kadar büyüt, sonraki kademede oradan kendi üssüyle devam et
  let p = 1;
  let from = 1;
  for (let i = 0; i <= tiers.length; i++) {
    const to = Math.min(s, tiers[i] ?? Infinity);
    if (to > from) p *= Math.pow(to / from, exps[i] ?? exps[exps.length - 1]!);
    if (s <= (tiers[i] ?? Infinity)) break;
    from = Math.max(from, tiers[i]!);
  }
  return cfg.lenBase + cfg.lenK * (s < 1 ? Math.pow(s, exps[0]!) : p);
}

export function radiusForScore(cfg: SimConfig, score: number): number {
  const s = Math.max(0, score);
  const tiers = cfg.growthTierScores;
  const muls = cfg.rTierMul;
  const lg = (v: number) => Math.log2(1 + v / 10);
  let r = cfg.rBase;
  let from = 0;
  for (let i = 0; i <= tiers.length; i++) {
    const to = Math.min(s, tiers[i] ?? Infinity);
    if (to > from) r += cfg.rK * (muls[i] ?? muls[muls.length - 1]!) * (lg(to) - lg(from));
    if (s <= (tiers[i] ?? Infinity)) break;
    from = tiers[i]!;
  }
  return r;
}

/** Ayarlardaki oyun hızı sürgüsünün sınırları. */
export const SPEED_SCALE_MIN = 0.5;
export const SPEED_SCALE_MAX = 2;

export function clampSpeedScale(v: number): number {
  return Number.isFinite(v) ? Math.min(SPEED_SCALE_MAX, Math.max(SPEED_SCALE_MIN, v)) : 1;
}

/** Oyun içi hız tuşları: H hızlandırır, Y yavaşlatır, R 1.0x'e döndürür. */
export type SpeedChange = 'up' | 'down' | 'reset';
export const SPEED_KEY_STEP = 0.25;

export function changeSpeedScale(current: number, change: SpeedChange): number {
  if (change === 'reset') return 1;
  const next = current + (change === 'up' ? SPEED_KEY_STEP : -SPEED_KEY_STEP);
  // Sürgüden gelen ara değerler (ör. 1.1) bir sonraki adımda 0.25'in katına oturur
  const snapped = Math.round(next / SPEED_KEY_STEP) * SPEED_KEY_STEP;
  return clampSpeedScale(snapped);
}

export function speedFor(cfg: SimConfig, radius: number, boosting: boolean): number {
  return speedAtBoostLevel(cfg, radius, boosting ? 1 : 0);
}

/**
 * Hızlanma geçişindeki hız: `level` 0 = normal, 1 = tam boost. Arada smoothstep eğrisi
 * kullanılır; hem başlangıçta hem sonda ivme sıfırdan başlar, hız sıçramaz.
 */
export function speedAtBoostLevel(cfg: SimConfig, radius: number, level: number): number {
  const t = level <= 0 ? 0 : level >= 1 ? 1 : level * level * (3 - 2 * level);
  const base = cfg.baseSpeed + (cfg.boostSpeed - cfg.baseSpeed) * t;
  return (base * cfg.speedScale) / (1 + radius / cfg.sizeSlowdown);
}

/** En dar dönüş dairesinin yarıçapı (dünya birimi); hızdan ve boost'tan bağımsız. */
export function turnRadiusFor(cfg: SimConfig, radius: number): number {
  return radius * cfg.turnRadiusK;
}

/** rad/sn = hız / dönüş yarıçapı: hızlanınca daha hızlı döner, çizdiği daire aynı kalır. */
export function turnRateFor(cfg: SimConfig, radius: number, boosting: boolean): number {
  return speedFor(cfg, radius, boosting) / turnRadiusFor(cfg, radius);
}

export function magnetRadius(cfg: SimConfig, radius: number): number {
  return radius * cfg.magnetK + cfg.magnetBase;
}

export function foodRadius(value: number): number {
  return 3 + 2.6 * Math.sqrt(value);
}

/** Gövde, çizim/çarpışma için gereken uzunluğun biraz fazlasını tutar (interpolasyon payı). */
export function bodyTrimMargin(cfg: SimConfig): number {
  return cfg.boostSpeed * cfg.speedScale * DT + cfg.segmentSpacing * 2;
}
