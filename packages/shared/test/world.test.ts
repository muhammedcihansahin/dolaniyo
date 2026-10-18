import { describe, expect, it } from 'vitest';
import {
  DT,
  TICK_RATE,
  changeSpeedScale,
  foodRadius,
  lengthForScore,
  magnetRadius,
  radiusForScore,
  speedFor,
  turnRadiusFor,
  type SimConfig,
} from '../src/config';
import { FoodKind } from '../src/sim/FoodStore';
import { World, type SimEvent } from '../src/sim/World';

/** Ortam yemi olmayan, testte elle kurulan küçük bir dünya. */
function emptyWorld(cfg: Partial<SimConfig> = {}): World {
  return new World({ arenaRadius: 3000, foodDensity: 0, ...cfg }, 7);
}

function deaths(events: SimEvent[]) {
  return events.filter((e) => e.type === 'died');
}

/** Yılanı sürekli en dar dairede döndürür; çizdiği dairenin çapını (x yönündeki genişlik) döner. */
function turnDiameter(w: World, boost: boolean): number {
  const s = w.addSnake({ name: 't', color: 0, x: 0, y: 0, angle: 0, score: 400 });
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < 2 * TICK_RATE; i++) {
    w.setInput(s.id, s.angle + 1, boost);
    w.step();
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
  }
  expect(s.boosting).toBe(boost);
  return maxX - minX;
}

describe('World — hareket ve büyüme', () => {
  it('yılan sabit hızla ilerler ve hedef açıya dönüş hızı sınırıyla döner', () => {
    const w = emptyWorld();
    const s = w.addSnake({ name: 'a', color: 0, x: 0, y: 0, angle: 0 });
    w.setInput(s.id, Math.PI / 2, false);
    w.step();
    expect(s.angle).toBeGreaterThan(0);
    expect(s.angle).toBeLessThan(0.4); // tek tick'te 90° dönemez
    const speed = Math.hypot(s.x - s.px, s.y - s.py) / DT;
    expect(speed).toBeCloseTo(speedFor(w.cfg, s.radius, false), 0);
    expect(speed).toBeGreaterThan(260); // eski 230'un %20 fazlası (boya göre biraz yavaşlar)
  });

  it('hızlanınca da aynı dairede döner; dönüş dairesi gövde kalınlığının birkaç katı', () => {
    const normal = turnDiameter(emptyWorld(), false);
    const boosted = turnDiameter(emptyWorld(), true);
    const r = radiusForScore(emptyWorld().cfg, 400);
    const expected = 2 * turnRadiusFor(emptyWorld().cfg, r);
    // Tick'ler arası kirişler daireyi biraz küçültür
    expect(normal).toBeGreaterThan(expected * 0.9);
    expect(normal).toBeLessThanOrEqual(expected * 1.01);
    expect(Math.abs(boosted - normal) / normal).toBeLessThan(0.08);
  });

  it('normal hız eskisinden %20, hızlanmış hız %60 fazla', () => {
    const w = emptyWorld();
    expect(speedFor(w.cfg, 0, false)).toBeCloseTo(230 * 1.2);
    expect(speedFor(w.cfg, 0, true)).toBeCloseTo(460 * 1.6);
  });

  it('H/Y/R hız tuşları 0.25 adımla değiştirir, sınırlarda durur', () => {
    expect(changeSpeedScale(1, 'up')).toBe(1.25);
    expect(changeSpeedScale(1, 'down')).toBe(0.75);
    expect(changeSpeedScale(1.75, 'reset')).toBe(1);
    expect(changeSpeedScale(1.1, 'up')).toBe(1.25);
    expect(changeSpeedScale(2, 'up')).toBe(2.25);
    expect(changeSpeedScale(5, 'up')).toBe(5);
    expect(changeSpeedScale(0.5, 'down')).toBe(0.5);
  });

  it('oyun hızı sürgüsü hızı çarpar, dönüş dairesini değiştirmez', () => {
    const slow = emptyWorld();
    const fast = emptyWorld({ speedScale: 1.5 });
    expect(speedFor(fast.cfg, 20, true)).toBeCloseTo(speedFor(slow.cfg, 20, true) * 1.5);
    const a = turnDiameter(slow, false);
    const b = turnDiameter(fast, false);
    expect(Math.abs(b - a) / a).toBeLessThan(0.08);
    fast.setSpeedScale(10);
    expect(fast.cfg.speedScale).toBe(5);
  });

  it('gövde uzunluğu skora göre hesaplanan boyu izler', () => {
    const w = emptyWorld();
    const s = w.addSnake({ name: 'a', color: 0, x: 0, y: 0, angle: 0, score: 500 });
    for (let i = 0; i < 2 * TICK_RATE; i++) w.step();
    const b = s.body;
    let len = b.headGap(s.x, s.y);
    for (let i = 1; i < b.count; i++) len += Math.hypot(b.x(i) - b.x(i - 1), b.y(i) - b.y(i - 1));
    expect(len).toBeGreaterThanOrEqual(lengthForScore(w.cfg, 500));
    expect(s.length).toBeCloseTo(lengthForScore(w.cfg, 500));
  });

  it('yem yiyince skor artar, yakındaki yem mıknatısla çekilir', () => {
    const w = emptyWorld();
    const s = w.addSnake({ name: 'a', color: 0, x: 0, y: 0, angle: 0 });
    const near = w.food.add(40, 0, 3, 0, FoodKind.Ambient);
    const pulled = w.food.add(0, 70, 1, 0, FoodKind.Ambient);
    const y0 = w.food.y[pulled]!;
    w.step();
    expect(w.food.alive[near]).toBe(0);
    expect(s.score).toBeCloseTo(13);
    expect(w.food.alive[pulled] === 0 || w.food.y[pulled]! < y0).toBe(true);
  });

  it('kalınlık ve boy kademeli büyür: eşiklerde kesintisiz, üst kademede daha hızlı', () => {
    const cfg = emptyWorld().cfg;
    for (const t of cfg.growthTierScores) {
      expect(radiusForScore(cfg, t + 1e-6)).toBeCloseTo(radiusForScore(cfg, t - 1e-6), 3);
      expect(lengthForScore(cfg, t + 1e-6)).toBeCloseTo(lengthForScore(cfg, t - 1e-6), 1);
    }
    // Skor 10 katına çıktığında kalınlık artışı her kademede bir öncekinden büyük
    const gain = (a: number) => radiusForScore(cfg, a * 10) - radiusForScore(cfg, a);
    expect(gain(10_000)).toBeGreaterThan(gain(1_000) * 2);
    expect(gain(100_000)).toBeGreaterThan(gain(10_000) * 2);
    expect(gain(1_000_000)).toBeGreaterThan(gain(100_000) * 1.5);
    // Dev yılanın yanında az puanlı yılan küçük kalır
    expect(radiusForScore(cfg, 1e6) / radiusForScore(cfg, 400)).toBeGreaterThan(4.5);
    expect(lengthForScore(cfg, 1e6) / lengthForScore(cfg, 400)).toBeGreaterThan(100);
    expect(lengthForScore(cfg, 0.5)).toBeGreaterThan(cfg.lenBase);
  });

  it('büyümenin üst sınırı yok', () => {
    const w = emptyWorld();
    expect(radiusForScore(w.cfg, 1e6)).toBeGreaterThan(radiusForScore(w.cfg, 1e5));
    expect(radiusForScore(w.cfg, 1e6)).toBeGreaterThan(48); // eski üst sınır
  });

  it('500k skordan itibaren yem çekme dairesi 2 kat', () => {
    const cfg = emptyWorld().cfg;
    const r = radiusForScore(cfg, 500_000);
    expect(magnetRadius(cfg, r, 500_000)).toBeCloseTo(magnetRadius(cfg, r, 499_999) * 2);
    // Normal dairenin 1.5 katı uzaklıktaki yem: 499 999'da durur, 500 000'de çekilir
    for (const score of [499_999, 500_000]) {
      const w = emptyWorld();
      const s = w.addSnake({ name: 'a', color: 0, x: 0, y: 0, angle: 0, score });
      const d = magnetRadius(w.cfg, s.radius, 0) * 1.5;
      const f = w.food.add(-d * 0.7, d * 0.7, 1, 0, FoodKind.Ambient);
      const x0 = w.food.x[f]!;
      w.step();
      const pulled = w.food.alive[f] === 0 || w.food.x[f]! !== x0;
      expect(pulled).toBe(score >= 500_000);
    }
  });

  it('mıknatısla çekilen yem tick başındaki konumunu saklar (akıcı çizim için)', () => {
    const w = emptyWorld();
    w.addSnake({ name: 'a', color: 0, x: 0, y: 0, angle: 0 });
    const slot = w.food.add(0, 70, 1, 0, FoodKind.Ambient);
    w.step();
    expect(w.food.movedAt[slot]).toBe(w.tick);
    expect(w.food.px[slot]).toBeCloseTo(0);
    expect(w.food.py[slot]).toBeCloseTo(70);
    expect(w.food.y[slot]).toBeLessThan(70);
  });

  it('yenen ortam yemi yendiği bölgenin yakınında yeniden doğar', () => {
    const w = new World({ arenaRadius: 4000, foodDensity: 1 / 200000 }, 11);
    const target = w.ambientTarget;
    const s = w.addSnake({ name: 'a', color: 0, x: 0, y: 0, angle: 0 });
    // Hedef sayıyı aşmamak için uzaktaki bir ortam yemini kaldırıp kafanın önüne bir tane koy
    for (let i = 0; i < w.food.highWater; i++) {
      if (w.food.alive[i] && Math.hypot(w.food.x[i]!, w.food.y[i]!) > 2000) {
        w.food.remove(i);
        break;
      }
    }
    const eatenId = w.food.id[w.food.add(30, 0, 2, 0, FoodKind.Ambient)]!;
    const before = new Set<number>();
    for (let i = 0; i < w.food.highWater; i++) if (w.food.alive[i]) before.add(w.food.id[i]!);
    w.step();
    expect(w.drainEvents().some((e) => e.type === 'foodEaten' && e.foodId === eatenId)).toBe(true);
    expect(w.food.ambientCount).toBe(target);
    let spawned = 0;
    for (let i = 0; i < w.food.highWater; i++) {
      if (!w.food.alive[i] || before.has(w.food.id[i]!)) continue;
      spawned++;
      const d = Math.hypot(w.food.x[i]! - 30, w.food.y[i]! - 0);
      expect(d).toBeGreaterThanOrEqual(w.cfg.ambientRespawnMin - 1);
      expect(d).toBeLessThanOrEqual(w.cfg.ambientRespawnMax + 1);
    }
    expect(spawned).toBe(1);
    expect(s.alive).toBe(true);
  });

  it('ortam yemi yendikçe hedef yoğunluğa tamamlanır', () => {
    const w = new World({ arenaRadius: 2000 }, 3);
    const target = w.ambientTarget;
    expect(w.food.ambientCount).toBe(target);
    for (let i = 0; i < 20; i++) w.food.remove(i);
    w.step();
    expect(w.food.ambientCount).toBe(target);
  });
});

describe('World — hızlanma', () => {
  it('boost skoru düşürür ve kuyruktan yem bırakır', () => {
    const w = emptyWorld();
    const s = w.addSnake({ name: 'a', color: 5, x: 0, y: 0, angle: 0, score: 300 });
    w.setInput(s.id, 0, true);
    for (let i = 0; i < 2 * TICK_RATE; i++) w.step();
    const expectedDrain = 2 * (w.cfg.boostDrainBase + 300 * w.cfg.boostDrainK); // ~2 sn
    expect(300 - s.score).toBeGreaterThan(expectedDrain * 0.9);
    expect(300 - s.score).toBeLessThan(expectedDrain * 1.1);
    let dropped = 0;
    for (let i = 0; i < w.food.highWater; i++) {
      if (w.food.alive[i] && w.food.kind[i] === FoodKind.Boost) {
        dropped += w.food.value[i]!;
        expect(w.food.color[i]).toBe(5);
      }
    }
    expect(dropped).toBeGreaterThan(0);
    expect(dropped).toBeLessThanOrEqual((300 - s.score) * w.cfg.boostDropRatio + 1e-6);
  });

  it('boost yemi seyrek düşer (saniyede birkaç tane)', () => {
    const w = emptyWorld();
    const s = w.addSnake({ name: 'a', color: 5, x: -2000, y: 0, angle: 0, score: 1000 });
    w.setInput(s.id, 0, true);
    for (let i = 0; i < 2 * TICK_RATE; i++) w.step();
    let pellets = 0;
    for (let i = 0; i < w.food.highWater; i++) {
      if (w.food.alive[i] && w.food.kind[i] === FoodKind.Boost) pellets++;
    }
    expect(pellets).toBeGreaterThanOrEqual(2);
    expect(pellets).toBeLessThanOrEqual(8);
  });

  it('hızlanma sıçramaz: boost hızına kısa bir geçişle çıkar, bırakınca yumuşakça iner', () => {
    const w = emptyWorld();
    const s = w.addSnake({ name: 'a', color: 0, x: -2000, y: 0, angle: 0, score: 1000 });
    const speed = () => Math.hypot(s.x - s.px, s.y - s.py) / DT;
    w.step();
    const normal = speed();
    const full = speedFor(w.cfg, s.radius, true);
    const gap = full - normal;

    w.setInput(s.id, 0, true);
    const up: number[] = [];
    for (let i = 0; i < TICK_RATE; i++) {
      w.step();
      up.push(speed());
    }
    expect(up[0]! - normal).toBeLessThan(gap * 0.1); // ilk tick'te öne fırlamaz
    for (let i = 1; i < up.length; i++)
      expect(Math.abs(up[i]! - up[i - 1]!)).toBeLessThan(gap * 0.2);
    const rampTicks = up.findIndex((v) => v > normal + gap * 0.95);
    expect(rampTicks).toBeGreaterThan(4);
    expect(rampTicks).toBeLessThan(TICK_RATE / 2);
    expect(up.at(-1)).toBeCloseTo(speedFor(w.cfg, s.radius, true), 0);

    w.setInput(s.id, 0, false);
    const top = speed();
    w.step();
    expect(top - speed()).toBeLessThan(gap * 0.1); // bırakınca da anında yavaşlamaz
    for (let i = 0; i < TICK_RATE; i++) w.step();
    expect(speed()).toBeCloseTo(speedFor(w.cfg, s.radius, false), 0);
  });

  it('minimum skorun altına inemez, boost kendiliğinden kapanır', () => {
    const w = emptyWorld();
    const s = w.addSnake({ name: 'a', color: 0, x: 0, y: 0, angle: 0, score: 13 });
    w.setInput(s.id, 0, true);
    for (let i = 0; i < 3 * TICK_RATE; i++) w.step();
    expect(s.score).toBeCloseTo(w.cfg.boostMinScore);
    expect(s.boosting).toBe(false);
  });
});

describe('World — çarpışmalar', () => {
  it('arena sınırına çarpan ölür', () => {
    const w = emptyWorld();
    const s = w.addSnake({ name: 'a', color: 0, x: 2985, y: 0, angle: 0 });
    w.step();
    expect(s.alive).toBe(false);
    expect(deaths(w.drainEvents())).toMatchObject([{ id: s.id, reason: 'border', killerId: 0 }]);
  });

  it('başka yılanın gövdesine çarpan ölür, gövde sahibi yaşar', () => {
    const w = emptyWorld();
    // b yatay duruyor (kafası +x'te), a aşağıdan gövdesinin ortasına dik geliyor
    const b = w.addSnake({ name: 'b', color: 0, x: 200, y: 0, angle: 0, score: 200 });
    const a = w.addSnake({ name: 'a', color: 1, x: 100, y: 60, angle: -Math.PI / 2 });
    w.setInput(b.id, 0, false);
    w.setInput(a.id, -Math.PI / 2, false);
    for (let i = 0; i < 15 && a.alive; i++) w.step();
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(true);
    expect(deaths(w.drainEvents())).toMatchObject([{ id: a.id, reason: 'body', killerId: b.id }]);
  });

  it('kendi gövdesine çarpmak öldürmez', () => {
    const w = emptyWorld();
    const s = w.addSnake({ name: 'a', color: 0, x: 0, y: 0, angle: 0, score: 2000 });
    // Sürekli sola dönerek kendi etrafında dolaşır
    for (let i = 0; i < 6 * TICK_RATE; i++) {
      w.setInput(s.id, s.angle + 1, false);
      w.step();
    }
    expect(s.alive).toBe(true);
  });

  it('benzer boyutta kafa kafaya çarpışmada ikisi de ölür', () => {
    const w = emptyWorld();
    const leader = w.addSnake({ name: 'lider', color: 2, x: 1500, y: 1500, angle: 0, score: 5000 });
    const a = w.addSnake({ name: 'a', color: 0, x: -60, y: 0, angle: 0, score: 100 });
    const b = w.addSnake({ name: 'b', color: 1, x: 60, y: 0, angle: Math.PI, score: 120 });
    for (let i = 0; i < 10 && (a.alive || b.alive); i++) w.step();
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(false);
    expect(leader.alive).toBe(true);
    const reasons = deaths(w.drainEvents()).map((e) => e.type === 'died' && e.reason);
    expect(reasons).toEqual(['head', 'head']);
  });

  it('5x hızda boost yapan kafa gövdenin içinden geçip gitmez', () => {
    // Kafa tick başına ~120 u gider, gövde tüpü ~110 u genişliğinde: farklı başlangıç
    // aralıklarıyla denenir (yalnızca varış noktasına bakılsaydı bazıları içinden geçerdi)
    for (let off = 0; off < 120; off += 10) {
      const w = emptyWorld({ speedScale: 5 });
      const wall = w.addSnake({
        name: 'd',
        color: 0,
        x: 0,
        y: 900,
        angle: Math.PI / 2,
        score: 2000,
      });
      const a = w.addSnake({ name: 'a', color: 1, x: -2400 - off, y: 0, angle: 0, score: 1500 });
      const events: SimEvent[] = [];
      for (let i = 0; i < 60 && a.alive; i++) {
        w.setInput(wall.id, Math.PI / 2, false);
        w.setInput(a.id, 0, true);
        w.step();
        events.push(...w.drainEvents());
      }
      const d = deaths(events).find((e) => e.id === a.id);
      expect(d).toMatchObject({ reason: 'body', killerId: wall.id });
    }
  });

  it('kafa-kafada 1. sıradaki yılan hayatta kalır', () => {
    const w = emptyWorld();
    const a = w.addSnake({ name: 'a', color: 0, x: -60, y: 0, angle: 0, score: 150 });
    const b = w.addSnake({ name: 'b', color: 1, x: 60, y: 0, angle: Math.PI, score: 100 });
    for (let i = 0; i < 10 && b.alive; i++) w.step();
    expect(a.alive).toBe(true);
    expect(b.alive).toBe(false);
  });

  it('kafa-kafada çok daha büyük olan hayatta kalır', () => {
    const w = emptyWorld();
    w.addSnake({ name: 'lider', color: 2, x: 1500, y: 1500, angle: 0, score: 9000 });
    const big = w.addSnake({ name: 'big', color: 0, x: -70, y: 0, angle: 0, score: 400 });
    const small = w.addSnake({ name: 'small', color: 1, x: 70, y: 0, angle: Math.PI, score: 150 });
    for (let i = 0; i < 10 && small.alive; i++) w.step();
    expect(big.alive).toBe(true);
    expect(small.alive).toBe(false);
  });

  it('ölen yılan skorunun bir kısmını yem olarak bırakır', () => {
    const w = emptyWorld();
    // Kafa ilk tick'te sınıra değsin
    const x = w.cfg.arenaRadius - radiusForScore(w.cfg, 1000) + 2;
    const s = w.addSnake({ name: 'a', color: 9, x, y: 0, angle: 0, score: 1000 });
    w.step();
    expect(s.alive).toBe(false);
    let total = 0;
    for (let i = 0; i < w.food.highWater; i++) {
      if (w.food.alive[i] && w.food.kind[i] === FoodKind.Death) {
        total += w.food.value[i]!;
        expect(w.food.color[i]).toBe(9);
        expect(Math.hypot(w.food.x[i]!, w.food.y[i]!)).toBeLessThan(w.cfg.arenaRadius);
      }
    }
    expect(total).toBeCloseTo(s.score * w.cfg.deathDropRatio, 3);
  });

  it('ölüm yemleri gövde boyunca sık ve gövde kalınlığında dizilir', () => {
    const w = emptyWorld();
    const s = w.addSnake({ name: 'a', color: 3, x: 0, y: 0, angle: 0, score: 800 });
    for (let i = 0; i < 4 * TICK_RATE; i++) w.step();
    w.removeSnake(s.id);
    const orbs: number[] = [];
    for (let i = 0; i < w.food.highWater; i++) {
      if (w.food.alive[i] && w.food.kind[i] === FoodKind.Death) orbs.push(i);
    }
    const expected = Math.floor(s.length / (s.radius * w.cfg.deathOrbSpacing)) + 1;
    expect(orbs.length).toBeGreaterThanOrEqual(expected - 2);
    for (const i of orbs) {
      expect(w.food.radius[i]).toBeGreaterThanOrEqual(s.radius * w.cfg.deathOrbSizeMin - 1e-3);
      expect(w.food.radius[i]).toBeLessThanOrEqual(s.radius * w.cfg.deathOrbSizeMax + 1e-3);
    }
  });

  it('ölüm yemi kısa süre yenmez: yakındaki kafa baş kısmını anında süpüremez', () => {
    const w = emptyWorld();
    const a = w.addSnake({ name: 'a', color: 3, x: 0, y: 0, angle: 0, score: 400 });
    w.step();
    // b, a'nın başının hemen yanından gövdesi boyunca ilerler
    const b = w.addSnake({ name: 'b', color: 1, x: 40, y: 30, angle: Math.PI });
    w.removeSnake(a.id);
    w.drainEvents();
    const deathEaten = () =>
      w.drainEvents().filter((e) => e.type === 'foodEaten' && e.kind === FoodKind.Death).length;
    let early = 0;
    for (let i = 0; i < w.cfg.deathFoodSettleTicks - 1; i++) {
      w.step();
      early += deathEaten();
    }
    expect(early).toBe(0);
    let late = 0;
    for (let i = 0; i < 10; i++) {
      w.step();
      late += deathEaten();
    }
    expect(late).toBeGreaterThan(0);
    expect(b.alive).toBe(true);
  });
});

describe('World — ortam yemi büyümesi', () => {
  it('ortam yemi taban değerinin ambientGrowth katı kadar büyütür; boyutu taban değerden', () => {
    const w = new World({ arenaRadius: 2000 }, 4);
    let n = 0;
    for (let i = 0; i < w.food.highWater; i++) {
      if (!w.food.alive[i] || w.food.kind[i] !== FoodKind.Ambient) continue;
      const base = w.food.value[i]! / w.cfg.ambientGrowth;
      expect(Number.isInteger(base)).toBe(true);
      expect(base).toBeGreaterThanOrEqual(w.cfg.ambientValueMin);
      expect(base).toBeLessThanOrEqual(w.cfg.ambientValueMax);
      expect(w.food.radius[i]).toBeCloseTo(foodRadius(base), 4);
      n++;
    }
    expect(n).toBe(w.ambientTarget);
  });
});

describe('World — ortam yemi sınırlı', () => {
  it('kimse yemese de ortam yemi hedefte sabit kalır ve hiçbiri sönmez', () => {
    const w = new World({ arenaRadius: 3000, foodDensity: 1 / 50000 }, 9);
    expect(w.food.ambientCount).toBe(w.ambientTarget);
    for (let i = 0; i < 120 * TICK_RATE; i++) w.step();
    expect(w.food.ambientCount).toBe(w.ambientTarget);
    for (let i = 0; i < w.food.highWater; i++) {
      if (w.food.alive[i] && w.food.kind[i] === FoodKind.Ambient) {
        expect(w.food.expire[i]).toBe(-1);
      }
    }
  });
});

describe('World — kara delik (1M)', () => {
  it("1M'a ulaşan yılan o anki bütün yemi bir kez çekip yutar", () => {
    const w = emptyWorld();
    const s = w.addSnake({ name: 'a', color: 0, x: 0, y: 0, angle: 0, score: 999_000 });
    expect(s.blackHoleDone).toBe(false);
    // Kafanın önünde 1M'ı geçiren yem, haritanın her yerinde de yemler
    w.food.add(s.radius * 0.5, 0, 2000, 0, FoodKind.Ambient);
    let total = 0;
    for (let i = 0; i < 300; i++) {
      const th = i * 2.39996;
      const r = 2800 * Math.sqrt((i + 0.5) / 300);
      w.food.add(Math.cos(th) * r, Math.sin(th) * r, 10, 1, FoodKind.Ambient);
      total += 10;
    }
    w.step(); // yemleri doğduktan sonraki tick'te yer, eşiği geçer
    w.step();
    const events: SimEvent[] = [...w.drainEvents()];
    expect(events.filter((e) => e.type === 'blackHole')).toHaveLength(1);
    const before = s.score;
    const late = w.food.add(-2500, 0, 10, 1, FoodKind.Ambient); // sonradan doğan çekilmez
    for (let i = 0; i < w.cfg.blackHoleTicks + 5; i++) {
      w.setInput(s.id, 0, false);
      w.step();
      events.push(...w.drainEvents());
    }
    expect(s.alive).toBe(true);
    expect(w.food.aliveCount).toBe(1);
    expect(w.food.alive[late]).toBe(1);
    expect(s.score).toBeGreaterThan(before);
    expect(s.score).toBeCloseTo(999_000 + 2000 + total, 3);
    // Bir kez: skor yeniden eşiği geçse de ikinci kara delik yok
    s.score = 500_000;
    w.step();
    s.score = 1_200_000;
    w.step();
    expect(w.drainEvents().some((e) => e.type === 'blackHole')).toBe(false);
  });

  it('o skorla doğan yılan kara delik açmaz', () => {
    const w = emptyWorld();
    w.addSnake({ name: 'a', color: 0, x: 0, y: 0, angle: 0, score: 2_000_000 });
    w.step();
    expect(w.drainEvents().some((e) => e.type === 'blackHole')).toBe(false);
  });
});
