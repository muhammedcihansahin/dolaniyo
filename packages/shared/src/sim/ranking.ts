export interface Rankable {
  readonly score: number;
  readonly spawnTick: number;
}

/** Eşit skorda önce doğan önde. */
function ahead(a: Rankable, b: Rankable): boolean {
  return a.score > b.score || (a.score === b.score && a.spawnTick < b.spawnTick);
}

/** Skora göre sıralı ilk `n` yılan. */
export function topSnakes<T extends Rankable>(list: readonly T[], n: number): T[] {
  return [...list].sort((a, b) => b.score - a.score || a.spawnTick - b.spawnTick).slice(0, n);
}

/** En yüksek `n` skorun toplamı. */
export function topScoreSum(list: readonly Rankable[], n: number): number {
  if (list.length <= n) {
    let sum = 0;
    for (const s of list) sum += s.score;
    return sum;
  }
  const scores = list.map((s) => s.score).sort((a, b) => b - a);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += scores[i]!;
  return sum;
}

/** 1'den başlayan sıra; yılan yoksa 0. */
export function rankAmong(list: readonly Rankable[], s: Rankable | undefined): number {
  if (!s) return 0;
  let rank = 1;
  for (const o of list) if (ahead(o, s)) rank++;
  return rank;
}
