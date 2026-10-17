import { describe, expect, it } from 'vitest';
import { angleDiff, normalizeAngle, pointSegDistSq } from '../src/math';
import { parseNickInput, sanitizeNick } from '../src/nick';
import { Rng } from '../src/rng';

describe('math', () => {
  it('normalizeAngle [-PI, PI) aralığına getirir', () => {
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(-Math.PI);
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    expect(normalizeAngle(2 * Math.PI + 0.5)).toBeCloseTo(0.5);
  });

  it('angleDiff en kısa yönü verir', () => {
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(-0.2);
  });

  it('pointSegDistSq doğru parçasına uzaklık', () => {
    expect(pointSegDistSq(5, 3, 0, 0, 10, 0)).toBeCloseTo(9);
    expect(pointSegDistSq(-4, 3, 0, 0, 10, 0)).toBeCloseTo(25);
  });
});

describe('Rng', () => {
  it('aynı tohum aynı diziyi üretir', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

describe('nick', () => {
  it('kontrol ve görünmez karakterleri temizler, 16 karakterle sınırlar', () => {
    expect(sanitizeNick('  Ali​\u0007  Veli ')).toBe('Ali Veli');
    expect(sanitizeNick('ÇokUzunBirTakmaAdBurada')).toBe('ÇokUzunBirTakmaA');
    expect(sanitizeNick('   ')).toBeNull();
  });

  it('Ad@Oda biçimini ayrıştırır', () => {
    expect(parseNickInput('Oyuncu@Arkadaslar')).toEqual({ nick: 'Oyuncu', room: 'arkadaslar' });
    expect(parseNickInput('Oyuncu@geçersiz oda')).toEqual({ nick: 'Oyuncu', room: null });
    expect(parseNickInput('Yalnız')).toEqual({ nick: 'Yalnız', room: null });
  });
});
