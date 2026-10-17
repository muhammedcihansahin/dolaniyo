export interface InputFrame {
  angle: number;
  boost: boolean;
}

const KEY_TURN_LEAD = 1.0; // klavyeyle dönerken hedef açının önde tutulduğu miktar (rad)

/**
 * Fare + klavye girdisi. Yön, ekran merkezinden (kamera kafayı ortalar) imlece olan açıdır.
 * Dokunmatik ve gamepad Faz 7'de eklenecek.
 */
export class Input {
  onEscape: (() => void) | null = null;

  private mouseX = 0;
  private mouseY = 0;
  private mouseBoost = false;
  private keyBoost = false;
  private left = false;
  private right = false;
  private useKeys = false;

  constructor(private readonly surface: HTMLElement) {
    window.addEventListener('pointermove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.useKeys = false;
    });
    surface.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.mouseBoost = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.mouseBoost = false;
    });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.reset());
  }

  reset(): void {
    this.mouseBoost = this.keyBoost = this.left = this.right = false;
  }

  /** `heading`: yılanın şu anki açısı (klavye modunda hedef ona göre hesaplanır). */
  read(heading: number): InputFrame {
    const boost = this.mouseBoost || this.keyBoost;
    const turn = (this.right ? 1 : 0) - (this.left ? 1 : 0);
    if (turn !== 0) this.useKeys = true;
    if (this.useKeys) return { angle: heading + turn * KEY_TURN_LEAD, boost };
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
    }
  }
}
