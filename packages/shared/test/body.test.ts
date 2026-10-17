import { describe, expect, it } from 'vitest';
import { Body } from '../src/sim/Body';

function pathLength(b: Body, hx: number, hy: number): number {
  let len = b.headGap(hx, hy);
  for (let i = 1; i < b.count; i++) len += Math.hypot(b.x(i) - b.x(i - 1), b.y(i) - b.y(i - 1));
  return len;
}

describe('Body', () => {
  it('reset kafanın arkasına düz gövde kurar', () => {
    const b = new Body(6);
    b.reset(100, 50, 0, 60);
    expect(b.count).toBe(10);
    expect(b.x(0)).toBeCloseTo(94);
    expect(b.x(b.count - 1)).toBeCloseTo(40);
    expect(b.y(5)).toBeCloseTo(50);
  });

  it('advance noktaları tam olarak sabit aralıkla ekler', () => {
    const b = new Body(6);
    b.reset(0, 0, 0, 30);
    let x = 0;
    for (let t = 0; t < 50; t++) {
      x += 7.3;
      b.advance(x, 0);
    }
    for (let i = 1; i < b.count; i++) {
      expect(Math.hypot(b.x(i) - b.x(i - 1), b.y(i) - b.y(i - 1))).toBeCloseTo(6, 4);
    }
    expect(b.headGap(x, 0)).toBeLessThan(6);
  });

  it('trim yolu en az istenen uzunlukta, fazlasız tutar', () => {
    const b = new Body(6);
    b.reset(0, 0, 0, 300);
    b.trim(0, 0, 100);
    const len = pathLength(b, 0, 0);
    expect(len).toBeGreaterThanOrEqual(100);
    expect(len).toBeLessThan(100 + 6);
  });

  it('kapasiteyi aşınca büyür ve sırayı korur', () => {
    const b = new Body(1, 16);
    for (let i = 0; i < 100; i++) b.push(i, -i);
    expect(b.count).toBe(100);
    expect(b.x(0)).toBe(99);
    expect(b.x(99)).toBe(0);
    expect(b.y(10)).toBe(-89);
  });

  it('pointAt yol üzerinde enterpolasyon yapar', () => {
    const b = new Body(6);
    b.reset(0, 0, 0, 60);
    const p = { x: 0, y: 0 };
    b.pointAt(0, 0, 3, p);
    expect(p.x).toBeCloseTo(-3);
    b.pointAt(0, 0, 21, p);
    expect(p.x).toBeCloseTo(-21);
    b.pointAt(0, 0, 1000, p);
    expect(p.x).toBeCloseTo(b.x(b.count - 1));
  });
});
