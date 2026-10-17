import { Container, Sprite, type Texture } from 'pixi.js';
import { TEX_RADIUS } from './textures';

/**
 * Her karede yeniden kullanılan sprite havuzu: begin() → next() × N → end().
 * Kullanılmayan sprite'lar silinmez, gizlenir (GC baskısı olmaz).
 */
export class SpritePool {
  private readonly sprites: Sprite[] = [];
  private used = 0;

  constructor(
    readonly container: Container,
    private readonly texture: Texture,
  ) {}

  begin(): void {
    this.used = 0;
  }

  /** (x, y) konumunda, `radius` dünya birimi yarıçapında bir sprite döner. */
  next(x: number, y: number, radius: number, tint: number, alpha = 1): Sprite {
    let s = this.sprites[this.used];
    if (!s) {
      s = new Sprite(this.texture);
      s.anchor.set(0.5);
      this.container.addChild(s);
      this.sprites.push(s);
    }
    this.used++;
    s.visible = true;
    s.position.set(x, y);
    s.scale.set(radius / TEX_RADIUS);
    s.tint = tint;
    s.alpha = alpha;
    return s;
  }

  end(): void {
    for (let i = this.used; i < this.sprites.length; i++) this.sprites[i]!.visible = false;
  }
}
