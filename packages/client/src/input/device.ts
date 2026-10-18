/**
 * Dokunmatik mod: en son dokunmatik ekranla mı yoksa fareyle mi oynandığı. İlk değer ana işaretçi
 * türünden gelir; dokunmatik + fareli (ör. Surface) cihazlarda son kullanılana göre değişir.
 * `<body>`'deki `touch` sınıfı arayüz yerleşimini (joystick, hızlanma düğmesi) buna göre seçer.
 */
let touch = matchMedia('(pointer: coarse)').matches;
const listeners: ((touch: boolean) => void)[] = [];

function set(value: boolean): void {
  if (value === touch) return;
  touch = value;
  apply();
}

function apply(): void {
  document.body.classList.toggle('touch', touch);
  for (const fn of listeners) fn(touch);
}

window.addEventListener(
  'pointerdown',
  (e) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') set(true);
    else if (e.pointerType === 'mouse') set(false);
  },
  { capture: true },
);
window.addEventListener(
  'pointermove',
  (e) => {
    // Dokunmadan sonra tarayıcının ürettiği sahte fare hareketlerini saymamak için kısa mesafe yetmez
    if (e.pointerType === 'mouse' && Math.abs(e.movementX) + Math.abs(e.movementY) > 2) set(false);
  },
  { capture: true },
);
document.body.classList.toggle('touch', touch);

export function isTouch(): boolean {
  return touch;
}

/** Hemen bir kez de çağrılır. */
export function onTouchChange(fn: (touch: boolean) => void): void {
  listeners.push(fn);
  fn(touch);
}
