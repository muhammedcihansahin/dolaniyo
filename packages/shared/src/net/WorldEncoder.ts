import type { Snake } from '../sim/Snake';
import type { SimEvent, World } from '../sim/World';
import { BinaryWriter } from './binary';
import { BinMsg, DEATH_REASONS, packAngle } from './protocol';

const FLAG_BOOST = 1;
const FLAG_BOT = 2;

/**
 * Sunucu tarafı: odanın dünyasını ikili mesajlara kodlar. Her istemciye aynı tick akışı gider;
 * yeni katılan önce `encodeInit()` ile tüm durumu alır.
 *
 * Gövde noktaları yalnızca yılan ilk göründüğünde gönderilir; sonrasında istemci her tick gelen
 * kafa konumundan aynı `Body` algoritmasıyla gövdeyi kendisi uzatır (bkz. WorldMirror).
 *
 * TICK düzeni: tick, [yeni yılan (tam kayıt)], [yılan güncellemesi], [ölen yılan],
 * [eklenen yem], [taşınan yem], [sönme zamanı değişen yem], [silinen yem].
 */
export class WorldEncoder {
  /** Akışta en az bir kez tam kaydı gönderilmiş yılanlar. */
  private readonly known = new Set<number>();
  private readonly w = new BinaryWriter(64 * 1024);
  private readonly fresh: Snake[] = [];

  constructor(private readonly world: World) {
    world.food.trackChanges = true;
    world.food.clearChanges();
  }

  encodeInit(): Uint8Array<ArrayBuffer> {
    const { world, w } = this;
    w.reset();
    w.u8(BinMsg.Init);
    w.u32(world.tick);
    w.u16(world.snakeList.length);
    for (const s of world.snakeList) writeSnakeFull(w, s);
    const food = world.food;
    const at = w.reserveU32();
    let n = 0;
    for (let slot = 0; slot < food.highWater; slot++) {
      if (!food.alive[slot]) continue;
      w.u32(food.id[slot]!);
      w.f32(food.x[slot]!);
      w.f32(food.y[slot]!);
      w.f32(food.radius[slot]!);
      w.u8(food.color[slot]!);
      w.u8(food.kind[slot]!);
      w.i32(food.expire[slot]!);
      n++;
    }
    w.patchU32(at, n);
    return w.finish();
  }

  /** `world.step()` ve `drainEvents()` sonrası çağrılır; yemin değişiklik kaydını boşaltır. */
  encodeTick(events: readonly SimEvent[]): Uint8Array<ArrayBuffer> {
    const { world, w, known, fresh } = this;
    const food = world.food;
    w.reset();
    w.u8(BinMsg.Tick);
    w.u32(world.tick);

    fresh.length = 0;
    for (const s of world.snakeList) if (!known.has(s.id)) fresh.push(s);
    w.u16(fresh.length);
    for (const s of fresh) {
      writeSnakeFull(w, s);
      known.add(s.id);
    }

    w.u16(world.snakeList.length - fresh.length);
    for (const s of world.snakeList) {
      if (fresh.includes(s)) continue;
      w.u32(s.id);
      w.f32(s.x);
      w.f32(s.y);
      w.u16(packAngle(s.angle));
      w.u16(packAngle(s.targetAngle));
      w.f32(s.score);
      w.u8(s.boosting ? FLAG_BOOST : 0);
    }

    const deathsAt = w.reserveU32();
    let deaths = 0;
    for (const e of events) {
      if (e.type !== 'died') continue;
      known.delete(e.id);
      w.u32(e.id);
      w.u8(DEATH_REASONS.indexOf(e.reason));
      w.u32(e.killerId);
      w.f32(e.score);
      deaths++;
    }
    w.patchU32(deathsAt, deaths);

    const adds = food.addLog;
    w.u32(adds.length / 7);
    for (let i = 0; i < adds.length; i += 7) {
      w.u32(adds[i]!);
      w.f32(adds[i + 1]!);
      w.f32(adds[i + 2]!);
      w.f32(adds[i + 3]!);
      w.u8(adds[i + 4]!);
      w.u8(adds[i + 5]!);
      w.i32(adds[i + 6]!);
    }

    const movesAt = w.reserveU32();
    let moves = 0;
    for (const slot of food.moveLog) {
      // Bu tick taşınıp yenen (ve slotu başka yeme geçen) yemler atlanır
      if (!food.alive[slot] || food.movedAt[slot] !== world.tick) continue;
      w.u32(food.id[slot]!);
      w.f32(food.x[slot]!);
      w.f32(food.y[slot]!);
      moves++;
    }
    w.patchU32(movesAt, moves);

    const expires = food.expireLog;
    w.u32(expires.length / 2);
    for (let i = 0; i < expires.length; i += 2) {
      w.u32(expires[i]!);
      w.i32(expires[i + 1]!);
    }

    const removes = food.removeLog;
    w.u32(removes.length / 2);
    for (let i = 0; i < removes.length; i += 2) {
      w.u32(removes[i]!);
      w.u32(removes[i + 1]!);
    }

    food.clearChanges();
    return w.finish();
  }
}

/** Yılanın tam kaydı: kimlik, görünüm, kafa durumu ve kafadan kuyruğa tüm gövde noktaları. */
function writeSnakeFull(w: BinaryWriter, s: Snake): void {
  w.u32(s.id);
  w.u32(s.spawnTick);
  w.u8(s.color);
  w.u8((s.boosting ? FLAG_BOOST : 0) | (s.isBot ? FLAG_BOT : 0));
  w.str(s.name);
  w.f32(s.x);
  w.f32(s.y);
  w.u16(packAngle(s.angle));
  w.u16(packAngle(s.targetAngle));
  w.f32(s.score);
  const b = s.body;
  w.u32(b.count);
  for (let i = 0; i < b.count; i++) {
    w.f32(b.x(i));
    w.f32(b.y(i));
  }
}
