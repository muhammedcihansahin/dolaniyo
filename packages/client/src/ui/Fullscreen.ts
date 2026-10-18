import { onLangChange, t } from '../i18n';

// Safari (iPad) yalnızca önekli API'yi destekler; iPhone Safari hiç desteklemez (düğme gizlenir)
interface WebkitDocument {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}
interface WebkitElement {
  webkitRequestFullscreen?: () => void;
}

const doc = document as Document & WebkitDocument;

function fullscreenElement(): Element | null {
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/** Sol üst köşedeki tam ekran aç/kapat düğmesi (menüde ve oyunda); F tuşu da aynı işi yapar. */
export class Fullscreen {
  private readonly btn = document.getElementById('fs-btn') as HTMLButtonElement;

  constructor() {
    if (!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled)) {
      this.btn.hidden = true;
      return;
    }
    this.btn.addEventListener('click', () => this.toggle());
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyF' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement) return;
      this.toggle();
      e.preventDefault();
    });
    document.addEventListener('fullscreenchange', () => this.render());
    document.addEventListener('webkitfullscreenchange', () => this.render());
    onLangChange(() => this.render());
  }

  toggle(): void {
    if (fullscreenElement()) {
      if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
      return;
    }
    const root = document.documentElement as HTMLElement & WebkitElement;
    if (root.requestFullscreen) {
      void root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    } else root.webkitRequestFullscreen?.();
  }

  private render(): void {
    const on = fullscreenElement() !== null;
    this.btn.classList.toggle('on', on);
    const label = t(on ? 'ui.exitFullscreen' : 'ui.fullscreen');
    this.btn.title = label;
    this.btn.setAttribute('aria-label', label);
    // Odak düğmede kalırsa Space/Enter onu tekrar tetikler
    this.btn.blur();
  }
}
