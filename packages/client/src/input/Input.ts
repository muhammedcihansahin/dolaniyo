import type { SpeedChange } from '@yilan/shared';
import { TouchControls } from './TouchControls';

export interface InputFrame {
  angle: number;
  boost: boolean;
}

const SPEED_KEYS: Partial<Record<string, SpeedChange>> = { h: 'up', y: 'down', r: 'reset' };

const KEY_TURN_LEAD = 1.0; // klavyeyle dönerken hedef açının önde tutulduğu miktar (rad)

/**
 * Fare + klavye + dokunmatik girdi. Farede yön, ekran merkezinden (kamera kafayı ortalar) imlece
 * olan açıdır; dokunmatikte sanal joystick'in yönü (bkz. TouchControls). En son kullanılan geçerlidir.
 */
export class Input {
  onEscape: (() => void) | null = null;
  /** H hızlandırır, Y yavaşlatır, R 1.0x'e döndürür (basılı tutunca tekrarlamaz). */
  onSpeedKey: ((change: SpeedChange) => void) | null = null;

  private mouseX = 0;
  private mouseY = 0;
  private mouseBoost = false;
  private keyBoost = false;
  private left = false;
  private right = false;
  private mode: 'mouse' | 'keys' | 'touch' = 'mouse';
  private readonly touch: TouchControls;

  constructor(private readonly surface: HTMLElement) {
    this.touch = new TouchControls(surface);
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mode = 'mouse';
    });
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType !== 'mouse') this.mode = 'touch';
      },
      { capture: true },
    );
    surface.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.mouseBoost = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.mouseBoost = false;
    });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.reset());
  }

  reset(): void {
    this.mouseBoost = this.keyBoost = this.left = this.right = false;
    this.touch.reset();
  }

  /** `heading`: yılanın şu anki açısı (klavye modunda hedef ona göre hesaplanır). */
  read(heading: number): InputFrame {
    const boost = this.mouseBoost || this.keyBoost || this.touch.boost;
    const turn = (this.right ? 1 : 0) - (this.left ? 1 : 0);
    if (turn !== 0) this.mode = 'keys';
    if (this.mode === 'keys') return { angle: heading + turn * KEY_TURN_LEAD, boost };
    if (this.mode === 'touch') return { angle: this.touch.steer ?? heading, boost };
    const rect = this.surface.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return { angle: Math.atan2(this.mouseY - cy, this.mouseX - cx), boost };
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.target instanceof HTMLInputElement) return;
    switch (e.code) {
      case 'Space':
      case 'ArrowUp':
      case 'KeyW':
        this.keyBoost = down;
        e.preventDefault();
        break;
      case 'ArrowLeft':
      case 'KeyA':
        this.left = down;
        e.preventDefault();
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.right = down;
        e.preventDefault();
        break;
      case 'Escape':
        if (down) this.onEscape?.();
        break;
      default: {
        // Tuşun üzerindeki harfe bakılır (klavye düzeni ne olursa olsun H/Y/R)
        const change = SPEED_KEYS[e.key.toLowerCase()];
        if (change && down && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
          this.onSpeedKey?.(change);
          e.preventDefault();
        }
      }
    }
  }
}
