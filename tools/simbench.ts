/**
 * Başsız simülasyon ölçümü: botlarla dolu bir dünyayı çalıştırır, tick süresini ve
 * bot davranış istatistiklerini (ölüm sebepleri, en yüksek skor) yazdırır.
 * Kullanım: npm run bench -- [saniye] [botSayısı] [arenaYarıçapı]
 */
import { BotController, TICK_RATE, World, type DeathReason } from '@yilan/shared';

const seconds = Number(process.argv[2] ?? 120);
const bots = Number(process.argv[3] ?? 20);
const arenaRadius = Number(process.argv[4] ?? 5000);

const world = new World({ arenaRadius }, 12345);
const controller = new BotController(world, { targetPopulation: bots, randomInitialScores: true });

const deaths: Record<DeathReason, number> = { border: 0, body: 0, head: 0, left: 0 };
let maxScore = 0;
let worstTick = 0;
const ticks = seconds * TICK_RATE;
const t0 = performance.now();
for (let t = 0; t < ticks; t++) {
  const a = performance.now();
  controller.update();
  world.step();
  const dt = performance.now() - a;
  if (dt > worstTick) worstTick = dt;
  for (const e of world.drainEvents()) if (e.type === 'died') deaths[e.reason]++;
  for (const s of world.snakeList) if (s.score > maxScore) maxScore = s.score;
}
const total = performance.now() - t0;

console.log(
  `Simüle edilen süre: ${seconds} sn (${ticks} tick), bot: ${bots}, arena: ${arenaRadius}`,
);
console.log(`Ortalama tick: ${(total / ticks).toFixed(3)} ms, en kötü: ${worstTick.toFixed(2)} ms`);
console.log(`Yem: ${world.food.aliveCount} (ortam hedefi ${world.ambientTarget})`);
console.log(`Ölümler (dakika başına):`, {
  sınır: +((deaths.border / seconds) * 60).toFixed(1),
  gövde: +((deaths.body / seconds) * 60).toFixed(1),
  kafa: +((deaths.head / seconds) * 60).toFixed(1),
});
console.log(`En yüksek skor: ${Math.round(maxScore)}`);
console.log(
  'Şu anki ilk 5:',
  world.getLeaderboard(5).map((s) => `${s.name} ${Math.round(s.score)}`),
);
