import { describe, expect, it } from 'vitest';
import { DT, TICK_RATE, lengthForScore, radiusForScore } from '../src/config';
import { BotController } from '../src/sim/bots/BotController';
import { FoodKind } from '../src/sim/FoodStore';
import { World, type SimEvent } from '../src/sim/World';

/** Ortam yemi olmayan, testte elle kurulan küçük bir dünya. */
function emptyWorld(): World {
  return new World({ arenaRadius: 3000, foodDensity: 0 }, 7);
}

function deaths(events: SimEvent[]) {
  return events.filter((e) => e.type === 'died');
}

describe('World — hareket ve büyüme', () => {
  it('yılan sabit hızla ilerler ve hedef açıya dönüş hızı sınırıyla döner', () => {
    const w = emptyWorld();
    const s = w.addSnake({ name: 'a', color: 0, x: 0, y: 0, angle: 0 });
    w.setInput(s.id, Math.PI / 2, false);
    w.step();
    expect(s.angle).toBeGreaterThan(0);
    expect(s.angle).toBeLessThan(0.2); // tek tick'te 90° dönemez
    const speed = Math.hypot(s.x - s.px, s.y - s.py) / DT;
    expect(speed).toBeGreaterThan(200);
    expect(speed).toBeLessThan(240);
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

  it('büyümenin üst sınırı yok', () => {
    const w = emptyWorld();
    expect(radiusForScore(w.cfg, 1e6)).toBeGreaterThan(radiusForScore(w.cfg, 1e5));
    expect(radiusForScore(w.cfg, 1e6)).toBeGreaterThan(48); // eski üst sınır
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
    for (let i = 0; i < TICK_RATE; i++) w.step();
    const expectedDrain = w.cfg.boostDrainBase + 300 * w.cfg.boostDrainK; // ~1 sn
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
    // r(1000) ≈ 28, yani kafa ilk tick'te sınıra değer
    const s = w.addSnake({ name: 'a', color: 9, x: 2965, y: 0, angle: 0, score: 1000 });
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
});

describe('World — botlar ve determinizm', () => {
  function runBots(seed: number, ticks: number) {
    const w = new World({ arenaRadius: 3000 }, seed);
    const bots = new BotController(w, { targetPopulation: 12, randomInitialScores: true });
    for (let i = 0; i < ticks; i++) {
      bots.update();
      w.step();
      w.drainEvents();
    }
    return w;
  }

  it('aynı tohumla aynı sonuca ulaşır', () => {
    const summary = (w: World) =>
      w.snakeList.map((s) => `${s.id}:${s.x.toFixed(3)},${s.y.toFixed(3)},${s.score.toFixed(3)}`);
    expect(summary(runBots(99, 600))).toEqual(summary(runBots(99, 600)));
  });

  it('botlar nüfusu hedefte tutar ve sınıra çarpmaz', () => {
    const w = new World({ arenaRadius: 3000 }, 5);
    const bots = new BotController(w, { targetPopulation: 12 });
    let borderDeaths = 0;
    for (let i = 0; i < 60 * TICK_RATE; i++) {
      bots.update();
      w.step();
      for (const e of w.drainEvents())
        if (e.type === 'died' && e.reason === 'border') borderDeaths++;
    }
    expect(borderDeaths).toBe(0);
    expect(w.snakes.size).toBeGreaterThanOrEqual(10);
    expect(w.snakes.size).toBeLessThanOrEqual(12);
  });
});
