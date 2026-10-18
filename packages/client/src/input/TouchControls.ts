/** Joystick bu kadar (CSS px) kaydırılmadan yön değişmez. */
const DEAD_ZONE = 8;

/**
 * Dokunmatik kontroller: ekranda herhangi bir yere dokunup sürüklemek sanal joystick gibi yön
 * verir (joystick parmağın değdiği yerde belirir), sağ alttaki düğme basılı tutulunca hızlanır.
 */
export class TouchControls {
  private readonly stick = document.getElementById('joystick')!;
  private readonly knob = document.getElementById('joystick-knob')!;
  private readonly boostBtn = document.getElementById('boost-btn')!;

  private stickId: number | null = null;
  private originX = 0;
  private originY = 0;
  private boostId: number | null = null;
  /** Son verilen yön; parmak kalkınca yılan bu yöne gitmeye devam eder. */
  private angle: number | null = null;

  constructor(surface: HTMLElement) {
    surface.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || this.stickId !== null) return;
      this.stickId = e.pointerId;
      this.originX = e.clientX;
      this.originY = e.clientY;
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.moveKnob(0, 0);
      this.stick.classList.add('active');
      capture(surface, e.pointerId);
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      const dx = e.clientX - this.originX;
      const dy = e.clientY - this.originY;
      const d = Math.hypot(dx, dy);
      if (d > DEAD_ZONE) this.angle = Math.atan2(dy, dx);
      // Topuz halkanın dışına taşmasın; parmak çok uzaklaşınca halka onu izler
      const max = this.stick.offsetWidth / 2;
      if (d > max * 1.6) {
        const k = (d - max * 1.6) / d;
        this.originX += dx * k;
        this.originY += dy * k;
        this.stick.style.left = `${this.originX}px`;
        this.stick.style.top = `${this.originY}px`;
      }
      const s = d > max ? max / d : 1;
      this.moveKnob(dx * s, dy * s);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.stick.classList.remove('active');
    };
    surface.addEventListener('pointerup', endStick);
    surface.addEventListener('pointercancel', endStick);

    this.boostBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.boostId = e.pointerId;
      this.boostBtn.classList.add('pressed');
      capture(this.boostBtn, e.pointerId);
    });
    const endBoost = (e: PointerEvent) => {
      if (e.pointerId !== this.boostId) return;
      this.boostId = null;
      this.boostBtn.classList.remove('pressed');
    };
    this.boostBtn.addEventListener('pointerup', endBoost);
    this.boostBtn.addEventListener('pointercancel', endBoost);
    this.boostBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get boost(): boolean {
    return this.boostId !== null;
  }

  /** Henüz yön verilmediyse null (yılan düz gider). */
  get steer(): number | null {
    return this.angle;
  }

  reset(): void {
    this.angle = null;
    this.stickId = this.boostId = null;
    this.stick.classList.remove('active');
    this.boostBtn.classList.remove('pressed');
  }

  private moveKnob(x: number, y: number): void {
    this.knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }
}

/** Parmak öğeden çıksa da olaylar ona gelsin; işaretçi çoktan kalktıysa tarayıcı hata atar. */
function capture(el: HTMLElement, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // yok say
  }
}
