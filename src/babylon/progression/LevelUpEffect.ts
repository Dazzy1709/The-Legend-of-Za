// src/babylon/progression/LevelUpEffect.ts
// The level-up "wind": a few thin rings that swirl up around the player,
// widening and fading as they rise, plus a short spiral of light motes —
// about 1.6 seconds, following the player if they keep moving, then gone.

import { Color3, Color4, DynamicTexture, Mesh, MeshBuilder, ParticleSystem, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";

const DURATION = 1.6;
const RING_COUNT = 3;

export function playLevelUpEffect(scene: Scene, getPosition: () => Vector3, tint = new Color3(0.75, 1, 0.8)) {
  const rings: { mesh: Mesh; material: StandardMaterial; delay: number; spin: number }[] = [];
  for (let i = 0; i < RING_COUNT; i++) {
    const mesh = MeshBuilder.CreateTorus(`levelup-ring-${i}`, { diameter: 1.1, thickness: 0.035, tessellation: 40 }, scene);
    mesh.isPickable = false;
    const material = new StandardMaterial(`levelup-ring-mat-${i}`, scene);
    material.emissiveColor = tint;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    material.alpha = 0;
    mesh.material = material;
    rings.push({ mesh, material, delay: i * 0.18, spin: (i % 2 === 0 ? 1 : -1) * (5 + i) });
  }

  const motes = createMotes(scene, getPosition(), tint);

  let elapsed = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    elapsed += dt;
    const base = getPosition();
    // The player's tracked position is the capsule's center, ~1 above the feet.
    const feetY = base.y - 0.9;
    for (const ring of rings) {
      const t = Math.max(0, Math.min(1, (elapsed - ring.delay) / (DURATION - ring.delay)));
      const eased = 1 - (1 - t) * (1 - t);
      ring.mesh.position.set(base.x, feetY + 0.1 + eased * 2.0, base.z);
      const scale = 0.7 + eased * 0.9;
      ring.mesh.scaling.set(scale, 1, scale);
      // A wobbling tilt plus a spin reads as a gust swirling round the body, not a flat halo.
      ring.mesh.rotation.set(Math.sin(elapsed * 6 + ring.delay * 10) * 0.25, ring.mesh.rotation.y + ring.spin * dt, Math.cos(elapsed * 5 + ring.delay * 7) * 0.25);
      ring.material.alpha = t <= 0 ? 0 : Math.sin(t * Math.PI) * 0.75;
    }
    motes.emitter = base.add(new Vector3(0, -0.9, 0));
    if (elapsed >= DURATION) {
      scene.onBeforeRenderObservable.remove(observer);
      for (const ring of rings) {
        ring.mesh.dispose();
        ring.material.dispose();
      }
      motes.stop();
      setTimeout(() => motes.dispose(), 1200);
    }
  });
}

/** Small glowing specks spiraling upward around the body. */
function createMotes(scene: Scene, at: Vector3, tint: Color3): ParticleSystem {
  const size = 32;
  const texture = new DynamicTexture("levelup-mote", size, scene, false);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  texture.update();
  texture.hasAlpha = true;

  const ps = new ParticleSystem("levelup-motes", 120, scene);
  ps.particleTexture = texture;
  ps.emitter = at.clone();
  ps.createCylinderEmitter(0.6, 0.2, 0.2, 0);
  ps.color1 = new Color4(tint.r, tint.g, tint.b, 0.9);
  ps.color2 = new Color4(1, 1, 1, 0.8);
  ps.colorDead = new Color4(tint.r, tint.g, tint.b, 0);
  ps.minSize = 0.04;
  ps.maxSize = 0.1;
  ps.minLifeTime = 0.6;
  ps.maxLifeTime = 1.1;
  ps.emitRate = 90;
  ps.minEmitPower = 0.6;
  ps.maxEmitPower = 1.4;
  ps.gravity = new Vector3(0, 1.6, 0);
  ps.minAngularSpeed = -4;
  ps.maxAngularSpeed = 4;
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();
  return ps;
}
