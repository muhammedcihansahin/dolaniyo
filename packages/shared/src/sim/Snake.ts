import { Body } from './Body';

/** Çizim ve arayüz katmanının bir yılandan okuduğu alanlar (istemci aynası da bunu sağlar). */
export interface SnakeLike {
  readonly id: number;
  readonly name: string;
  readonly color: number;
  readonly isBot: boolean;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  /** Önceki tick'teki kafa konumu/açısı — çizimde interpolasyon için. */
  readonly px: number;
  readonly py: number;
  readonly pangle: number;
  readonly targetAngle: number;
  readonly radius: number;
  readonly length: number;
  readonly score: number;
  readonly boosting: boolean;
  /** Doğduğu tick (sıralamada eşit skorda önce doğan önde). */
  readonly spawnTick: number;
  readonly body: Body;
}

export class Snake implements SnakeLike {
  x = 0;
  y = 0;
  angle = 0;
  px = 0;
  py = 0;
  pangle = 0;
  targetAngle = 0;
  wantBoost = false;
  boosting = false;
  /** Hızlanma geçişi: 0 = normal hız, 1 = tam boost (bkz. `speedAtBoostLevel`). */
  boostLevel = 0;
  score = 0;
  radius = 0;
  length = 0;
  alive = true;
  spawnTick = 0;
  /** Kara delik (1M) bu yılan için kullanıldı ya da yılan zaten o skorla doğdu. */
  blackHoleDone = false;
  /** Boost sırasında kuyruktan düşürülmeyi bekleyen skor. */
  boostDropAcc = 0;
  readonly body: Body;

  constructor(
    readonly id: number,
    public name: string,
    public color: number,
    readonly isBot: boolean,
    spacing: number,
  ) {
    this.body = new Body(spacing);
  }
}
