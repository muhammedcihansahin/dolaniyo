import { describe, expect, it } from 'vitest';
import { BinaryReader, BinaryWriter } from '../src/net/binary';
import {
  BinMsg,
  ChunkAssembler,
  MAX_CHUNK_BYTES,
  MAX_ROOM_PLAYERS,
  decodeInput,
  encodeInput,
  splitMessage,
  type ServerMessage,
  makeRoomCode,
  normalizeRoomCode,
  packAngle,
  unpackAngle,
} from '../src/net/protocol';
import { RoomHost, type RoomLink } from '../src/net/RoomHost';
import { WorldEncoder } from '../src/net/WorldEncoder';
import { WorldMirror } from '../src/net/WorldMirror';
import { BotController } from '../src/sim/bots/BotController';
import type { SimEvent } from '../src/sim/World';
import { World } from '../src/sim/World';

/** Aynadaki her yılan ve yem sunucudakiyle birebir aynı mı? */
function expectInSync(server: World, mirror: WorldMirror): void {
  expect(mirror.tick).toBe(server.tick);
  expect([...mirror.snakes.keys()].sort()).toEqual([...server.snakes.keys()].sort());
  for (const s of server.snakeList) {
    const m = mirror.snakes.get(s.id)!;
    expect(m.x).toBe(s.x);
    expect(m.y).toBe(s.y);
    expect(m.score).toBe(Math.fround(s.score));
    expect(m.name).toBe(s.name);
    // İstemci en az sunucu kadar nokta tutar ve ortak kısım bit bit aynıdır
    expect(m.body.count).toBeGreaterThanOrEqual(s.body.count);
    for (let i = 0; i < s.body.count; i++) {
      expect(m.body.x(i)).toBe(s.body.x(i));
      expect(m.body.y(i)).toBe(s.body.y(i));
    }
  }
  const foodOf = (w: { food: World['food'] }) => {
    const out = new Map<number, string>();
    const f = w.food;
    for (let i = 0; i < f.highWater; i++) {
      if (f.alive[i]) {
        out.set(f.id[i]!, `${f.x[i]},${f.y[i]},${f.radius[i]},${f.kind[i]},${f.expire[i]}`);
      }
    }
    return out;
  };
  expect(foodOf(mirror)).toEqual(foodOf(server));
}

describe('ikili yazıcı/okuyucu', () => {
  it('yazılanı aynen okur ve büyür', () => {
    const w = new BinaryWriter(4);
    w.u8(200);
    w.u16(60000);
    w.u32(4e9);
    w.i32(-5);
    w.f32(1.5);
    w.str('Şimşek🐍');
    const at = w.reserveU32();
    w.patchU32(at, 77);
    const r = new BinaryReader(w.finish());
    expect([r.u8(), r.u16(), r.u32(), r.i32(), r.f32(), r.str(), r.u32()]).toEqual([
      200,
      60000,
      4e9,
      -5,
      1.5,
      'Şimşek🐍',
      77,
    ]);
    expect(r.remaining).toBe(0);
    expect(() => r.u8()).toThrow(RangeError);
  });

  it('açı ve girdi kodlaması', () => {
    for (const a of [-Math.PI, -1, 0, 0.5, 3]) {
      expect(unpackAngle(packAngle(a))).toBeCloseTo(a, 3);
    }
    expect(decodeInput(encodeInput(1.25, true))).toEqual({
      angle: unpackAngle(packAngle(1.25)),
      boost: true,
    });
    expect(decodeInput(new Uint8Array([9, 0, 0, 0]))).toBeNull();
  });

  it('oda kodu üretimi ve doğrulama', () => {
    const code = makeRoomCode(Math.random);
    expect(normalizeRoomCode(code)).toBe(code);
    expect(normalizeRoomCode(` ${code.toLowerCase()} `)).toBe(code);
    expect(normalizeRoomCode('AB')).toBeNull();
    expect(normalizeRoomCode('ABCD0')).toBeNull();
  });
});

describe('WorldEncoder → WorldMirror', () => {
  it('istemci aynası botlu bir odayla tick tick senkron kalır', () => {
    const world = new World({ arenaRadius: 3000 }, 21);
    const bots = new BotController(world, { botCount: 14, randomInitialScores: true });
    const enc = new WorldEncoder(world);
    let mirror: WorldMirror | null = null;
    let eaten = 0;
    let died = 0;
    let serverEaten = 0;
    for (let t = 0; t < 900; t++) {
      bots.update();
      world.step();
      const events = world.drainEvents();
      const tick = enc.encodeTick(events);
      if (t === 300) {
        // Oyun sürerken katılan istemci: önce tüm durum, sonra akış
        mirror = new WorldMirror(world.cfg);
        mirror.apply(enc.encodeInit());
        expectInSync(world, mirror);
        continue;
      }
      if (!mirror) continue;
      const got: SimEvent[] = mirror.apply(tick);
      eaten += got.filter((e) => e.type === 'foodEaten').length;
      died += got.filter((e) => e.type === 'died').length;
      serverEaten += events.filter((e) => e.type === 'foodEaten').length;
      if (t % 50 === 0) expectInSync(world, mirror);
    }
    expectInSync(world, mirror!);
    expect(died).toBeGreaterThan(0);
    expect(eaten).toBeGreaterThan(0);
    expect(eaten).toBe(serverEaten);
  });

  it('büyüklük sınırında yemlerin sönme zamanı aynaya da gider (ve sınırdan çıkınca silinir)', () => {
    const world = new World(
      {
        arenaRadius: 3000,
        foodDensity: 1 / 100000,
        foodCapTopN: 1,
        foodCapHigh: 1000,
        foodCapLow: 750,
      },
      4,
    );
    const enc = new WorldEncoder(world);
    const mirror = new WorldMirror(world.cfg);
    mirror.apply(enc.encodeInit());
    const a = world.addSnake({ name: 'a', color: 0, x: 0, y: -800, angle: 1.5, score: 2000 });
    const run = (ticks: number) => {
      for (let i = 0; i < ticks; i++) {
        world.step();
        mirror.apply(enc.encodeTick(world.drainEvents()));
      }
    };
    run(15);
    expect(world.foodCapped).toBe(true);
    expectInSync(world, mirror);
    let fading = 0;
    for (let i = 0; i < mirror.food.highWater; i++) {
      if (mirror.food.alive[i] && mirror.food.expire[i]! >= 0) fading++;
    }
    expect(fading).toBe(mirror.food.aliveCount);
    a.score = 100;
    run(15);
    expect(world.foodCapped).toBe(false);
    expectInSync(world, mirror);
  });

  it('tick arasında doğan ve ayrılan oyuncular da aynaya yansır', () => {
    const world = new World({ arenaRadius: 3000, foodDensity: 1 / 100000 }, 3);
    const enc = new WorldEncoder(world);
    const mirror = new WorldMirror(world.cfg);
    mirror.apply(enc.encodeInit());
    const a = world.addSnake({ name: 'Ali', color: 2, score: 300 });
    // Katılım tick arasında olur: INIT'i alan yeni istemci, sonraki TICK'te aynı yılanı tekrar görür
    const late = new WorldMirror(world.cfg);
    late.apply(enc.encodeInit());
    world.step();
    const tick1 = enc.encodeTick(world.drainEvents());
    mirror.apply(tick1);
    late.apply(tick1);
    expectInSync(world, mirror);
    expectInSync(world, late);
    expect(mirror.snakes.get(a.id)!.name).toBe('Ali');

    world.removeSnake(a.id);
    world.step();
    const events = mirror.apply(enc.encodeTick(world.drainEvents()));
    expect(events.some((e) => e.type === 'died' && e.id === a.id && e.reason === 'left')).toBe(
      true,
    );
    expectInSync(world, mirror);
  });
});

describe('büyük mesaj parçalama', () => {
  it('parçalar birleşince aynı mesaj çıkar, küçük mesaj dokunulmadan geçer', () => {
    const big = new Uint8Array(MAX_CHUNK_BYTES * 3 + 123);
    for (let i = 0; i < big.length; i++) big[i] = (i * 7) & 0xff;
    big[0] = BinMsg.Init;
    const parts = splitMessage(big);
    expect(parts.length).toBe(4);
    for (const p of parts) expect(p.byteLength).toBeLessThanOrEqual(MAX_CHUNK_BYTES);
    const asm = new ChunkAssembler();
    const out = parts.map((p) => asm.push(p.slice().buffer));
    expect(out.slice(0, 3)).toEqual([null, null, null]);
    expect(new Uint8Array(out[3]!)).toEqual(big);

    const small = Uint8Array.of(BinMsg.Tick, 1, 2, 3);
    expect(splitMessage(small)).toEqual([small]);
    expect(new Uint8Array(asm.push(small.slice().buffer)!)).toEqual(small);
  });
});

describe('tarayıcıda çalışan oda (RoomHost)', () => {
  class FakeLink implements RoomLink {
    readonly text: ServerMessage[] = [];
    readonly binary: Uint8Array[] = [];
    buffered = 0;
    closed = false;
    send(data: string | Uint8Array<ArrayBuffer>): void {
      if (typeof data === 'string') this.text.push(JSON.parse(data) as ServerMessage);
      else this.binary.push(data);
    }
    close(): void {
      this.closed = true;
    }
  }

  function makeRoom() {
    let pump: (() => void) | null = null;
    let now = 0;
    const host = new RoomHost({
      code: 'K7QXP',
      botCount: 3,
      speedScale: 1,
      arenaRadius: 3000,
      lan: [],
      ticker: { start: (fn) => (pump = fn), stop: () => (pump = null) },
      now: () => now,
    });
    const advance = (ticks: number) => {
      for (let i = 0; i < ticks; i++) {
        now += 1000 / 30;
        pump?.();
      }
    };
    return { host, advance, running: () => pump !== null };
  }

  it('katılanlar aynı akışı alır, girdi kurucunun dünyasına işler', () => {
    const { host, advance } = makeRoom();
    const a = new FakeLink();
    const b = new FakeLink();
    const ma = host.add(a, true)!;
    advance(10);
    const mb = host.add(b)!;
    expect(a.text[0]).toMatchObject({ t: 'joined', code: 'K7QXP', bots: 3 });
    expect(b.text.some((m) => m.t === 'people' && m.count === 2)).toBe(true);

    const mirror = new WorldMirror(host.world.cfg);
    for (const d of b.binary) mirror.apply(d);
    host.receive(ma, JSON.stringify({ t: 'spawn', name: 'Cihan', color: 3 }));
    host.receive(mb, JSON.stringify({ t: 'spawn', name: 'Ali', color: 1 }));
    const id = (a.text.find((m) => m.t === 'spawned') as { id: number }).id;
    host.receive(ma, encodeInput(1.25, false));
    const from = b.binary.length;
    advance(30);
    for (const d of b.binary.slice(from)) mirror.apply(d);
    expectInSync(host.world, mirror);
    expect(Math.abs(host.world.snakes.get(id)!.targetAngle - 1.25)).toBeLessThan(0.001);
    expect(mirror.snakes.get(id)!.name).toBe('Cihan');

    host.remove(mb);
    expect(host.players).toBe(1);
    host.close();
    expect(a.closed).toBe(true);
  });

  it('tek kişi arka plandaysa durur, biri gelince sürer; dolu oda reddeder', () => {
    const { host, advance, running } = makeRoom();
    const owner = host.add(new FakeLink(), true)!;
    expect(running()).toBe(true);
    host.receive(owner, JSON.stringify({ t: 'away', away: true }));
    expect(running()).toBe(false);
    const tick = host.world.tick;
    advance(5);
    expect(host.world.tick).toBe(tick);
    host.add(new FakeLink());
    expect(running()).toBe(true);
    for (let i = 2; i < MAX_ROOM_PLAYERS; i++) host.add(new FakeLink());
    const late = new FakeLink();
    expect(host.add(late)).toBeNull();
    expect(late.text).toEqual([{ t: 'error', code: 'full' }]);
    expect(late.closed).toBe(true);
  });

  it('başkası oynarken hızı yalnızca kurucu değiştirebilir', () => {
    const { host } = makeRoom();
    const a = new FakeLink();
    const b = new FakeLink();
    const ma = host.add(a, true)!;
    const mb = host.add(b)!;
    host.receive(ma, JSON.stringify({ t: 'spawn', name: 'A', color: 0 }));
    host.receive(mb, JSON.stringify({ t: 'spawn', name: 'B', color: 0 }));
    host.receive(mb, JSON.stringify({ t: 'speed', change: 'up' }));
    expect(b.text.at(-1)).toEqual({ t: 'speedDenied' });
    host.receive(ma, JSON.stringify({ t: 'speed', change: 'up' }));
    expect(b.text.at(-1)).toMatchObject({ t: 'speed' });
    expect(host.world.cfg.speedScale).toBeGreaterThan(1);
  });
});
