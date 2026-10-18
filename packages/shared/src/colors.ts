/**
 * Ortak renk paleti. Yılan ve yem renkleri bu dizideki indeksle taşınır (ağda 1 bayt).
 * 0..15 yılan renkleri, 16.. yalnızca ortam yemi için açık tonlar.
 */
export const PALETTE: readonly number[] = [
  0xffe14d, // sarı
  0x4de8ff, // camgöbeği
  0xb9a8ff, // lavanta
  0x8fa8ff, // periwinkle
  0xff7ab8, // pembe
  0xff7a6b, // mercan
  0xffa94d, // turuncu
  0xb4ff4d, // limon yeşili
  0x4dff88, // yeşil
  0x3fe0c5, // turkuaz
  0x4d8dff, // mavi
  0xc56bff, // mor
  0xf2f6ff, // beyaz
  0xc9d3e6, // açık gri
  0xff4d5e, // kırmızı
  0xffcc33, // altın
  0xa6f4ff, // açık camgöbeği
  0xfff3a6, // açık sarı
  0xffc2de, // açık pembe
  0xd9d0ff, // açık lavanta
  0xb8ffd4, // nane
  0xffffff, // beyaz
];

export const SNAKE_COLOR_COUNT = 16;

/** Bütün yılanlar (oyuncular ve botlar) bu renkle çizilir: PALETTE'teki kırmızı. */
export const SNAKE_COLOR = 14;

export const AMBIENT_FOOD_COLORS: readonly number[] = [16, 17, 18, 19, 20, 21, 1, 0, 4, 2, 8];

export function colorToCss(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}
