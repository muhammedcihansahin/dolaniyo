import { ParticleContainer, type Container, type IParticle, type Texture } from 'pixi.js';
import { TEX_RADIUS } from './textures';

/**
 * Her karede yeniden kullanılan çizim havuzu: begin() → next() × N → end().
 *
 * Sprite yerine tek bir ParticleContainer içindeki düz parçacıklar kullanılır: parçacıklar
 * sahne ağacında düğüm değildir, sayıları her karede değişse de Pixi sahneyi baştan kurmaz
 * ve tüm havuz tek çizim çağrısında, tek tampon yüklemesiyle çizilir. Görüntü Sprite ile
 * aynıdır (aynı doku, ölçek, renk ve önceden çarpılmış saydamlık).
 */
export class SpritePool {
  readonly container: ParticleContainer;
  private readonly particles: IParticle[] = [];
  private used = 0;
  /** Statik özniteliklerin (uv, dönmüyorsa açı) GPU'ya yüklendiği en yüksek parçacık sayısı. */
  private staticCount = 0;

  /** `rotation`: parçacıklar döndürülecek mi (yalnızca kıvılcımlar). */
  constructor(
    parent: Container,
    private readonly texture: Texture,
    rotation = false,
  ) {
    this.container = parent.addChild(
      new ParticleContainer({
        texture,
        dynamicProperties: { vertex: true, position: true, color: true, rotation, uvs: false },
      }),
    );
  }

  begin(): void {
    this.used = 0;
  }

  /** (x, y) konumunda, `radius` dünya birimi yarıçapında bir parçacık döner. */
  next(x: number, y: number, radius: number, tint: number, alpha = 1): IParticle {
    let p = this.particles[this.used];
    if (!p) {
      p = {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        anchorX: 0.5,
        anchorY: 0.5,
        rotation: 0,
        color: 0,
        texture: this.texture,
      };
      this.particles.push(p);
    }
    this.container.particleChildren[this.used++] = p;
    p.x = x;
    p.y = y;
    p.scaleX = p.scaleY = radius / TEX_RADIUS;
    p.rotation = 0;
    // Pixi'nin Particle.tint/alpha ayarlayıcılarının ürettiği değer: ABGR, alfa üst baytta
    const a = alpha <= 0 ? 0 : alpha >= 1 ? 255 : (alpha * 255) | 0;
    p.color = ((a << 24) | ((tint & 0xff) << 16) | (tint & 0xff00) | ((tint >> 16) & 0xff)) >>> 0;
    return p;
  }

  end(): void {
    this.container.particleChildren.length = this.used;
    // Statik veriler yalnızca daha önce hiç olmayan kadar çok parçacık çizildiğinde yüklenir
    if (this.used > this.staticCount) {
      this.staticCount = this.used;
      this.container.update();
    }
  }
}
