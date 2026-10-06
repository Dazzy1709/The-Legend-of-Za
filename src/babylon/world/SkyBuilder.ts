// src/babylon/world/SkyBuilder.ts
import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Texture, Vector3 } from "@babylonjs/core";
import { SkyMaterial } from "@babylonjs/materials";
import { createCloudTexture, createSunDiscTexture } from "./TextureFactory";

/** Sky shader/cloud parameters that visibly change with weather — see WeatherSystem, which owns picking these per weather kind and interpolating between them during a transition. */
export interface SkyWeatherParams {
  turbidity: number;
  luminance: number;
  rayleigh: number;
  mieCoefficient: number;
  /** 0-1 — how opaque/dense the cloud layer reads overall (a material-level alpha multiplier, separate from the texture's own per-pixel alpha). */
  cloudCoverage: number;
  /** 0-1 — 0 = bright white puffy clouds, 1 = dark storm-grey. */
  cloudDarkness: number;
}

const CLOUD_ALTITUDE = 420; // above the mountain peaks
const CLOUD_LAYER_SIZE = 3200;
const CLOUD_DRIFT_SPEED = 0.006; // texture uOffset/sec — slow, so it reads as drifting, not scrolling

/**
 * The visible sky: a physically-shaded dome (Preetham/Rayleigh scattering
 * model — a real atmospheric shader, not a texture, so sunrise/sunset
 * color shifts happen for free and the horizon always matches the sun's
 * actual position) plus a separate cloud layer on top of it. The dome
 * alone can only simulate atmospheric haze (turbidity) — genuine
 * overcast/stormy-*looking* skies come from that, but actual puffy cloud
 * shapes need real geometry, which is what the cloud layer below adds: a
 * large flat plane high overhead, textured with a tiling procedural
 * cloud pattern (TextureFactory's createCloudTexture) that slowly drifts
 * via UV offset animation and re-centers over the player every frame so
 * it's always overhead no matter how far they roam.
 */
export class SkyBuilder {
  private readonly mesh: Mesh;
  private readonly material: SkyMaterial;
  private readonly cloudMesh: Mesh;
  private readonly cloudMaterial: StandardMaterial;
  private readonly cloudTexture: Texture;
  private readonly sunMesh: Mesh;
  private readonly sunMaterial: StandardMaterial;

  constructor(scene: Scene) {
    // A sphere, not a box — SkyMaterial's Preetham/Rayleigh scattering
    // shader is written for spherical geometry; a box's flat faces and
    // hard corners don't match what the shader's math expects at each
    // point, which is what was actually behind the sky not reading as
    // covering the whole sky properly (visible seams/discontinuities
    // near the box's own corners, not a coverage-radius problem).
    // Bigger than the world, so the far mountains are never cut off by it.
    this.mesh = MeshBuilder.CreateSphere("skyDome", { diameter: 6000, segments: 24 }, scene);
    this.mesh.infiniteDistance = true;

    this.material = new SkyMaterial("skyMat", scene);
    this.material.backFaceCulling = false;
    this.material.turbidity = 9;
    this.material.luminance = 0.95;
    this.material.rayleigh = 2.3;
    this.material.mieCoefficient = 0.006;
    this.material.mieDirectionalG = 0.8;
    this.material.useSunPosition = true;
    this.mesh.material = this.material;

    this.cloudMesh = MeshBuilder.CreatePlane("cloudLayer", { size: CLOUD_LAYER_SIZE }, scene);
    this.cloudMesh.rotation.x = Math.PI / 2; // lie flat (a plane defaults to standing vertical, facing +Z)
    this.cloudMesh.position.y = CLOUD_ALTITUDE;
    this.cloudMesh.isPickable = false;
    this.cloudMesh.infiniteDistance = true; // never left behind as the player roams the 200+ unit city

    this.cloudMaterial = new StandardMaterial("cloudMat", scene);
    const cloudTex = createCloudTexture(scene);
    // Same cloud size as before over the much bigger layer.
    cloudTex.uScale = 14;
    cloudTex.vScale = 14;
    this.cloudTexture = cloudTex;
    this.cloudMaterial.diffuseTexture = cloudTex;
    this.cloudMaterial.opacityTexture = cloudTex; // same texture instance — animating its uOffset below drives both at once
    this.cloudMaterial.specularColor = Color3.Black();
    // Not backFaceCulling-safe by default (a flat plane only has one
    // visible side) — disabled since the rotation sign that makes the
    // textured face point down at the player, versus up away from them,
    // isn't something I can verify without seeing it rendered; this
    // guarantees the clouds are visible regardless of which way that
    // turned out.
    this.cloudMaterial.backFaceCulling = false;
    // Clouds should read as lit by ambient sky light even on their
    // underside (facing away from direct sun much of the day), not go
    // flat black — emissiveColor is set per-frame in update() alongside
    // diffuseColor, both driven by the current weather's cloudDarkness.
    this.cloudMesh.material = this.cloudMaterial;

    // A real visible sun disc — the atmospheric shader's own glow around
    // the sun's position is subtle by design (it's meant to read as
    // atmospheric haze, not a light source itself), and there was
    // nothing else anywhere in the scene actually representing the sun
    // as a visible object. A billboarded, unlit-emissive plane: always
    // faces the camera regardless of viewing angle (so it always reads
    // as a clean disc, never an edge-on sliver), and disableLighting
    // means it reads as a genuine bright light source rather than
    // something that could itself fall into shadow or dim with the
    // scene's own ambient/sun intensity.
    this.sunMesh = MeshBuilder.CreatePlane("sunDisc", { size: 280 }, scene);
    this.sunMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.sunMesh.isPickable = false;
    this.sunMesh.infiniteDistance = true;
    this.sunMaterial = new StandardMaterial("sunDiscMat", scene);
    this.sunMaterial.diffuseColor = Color3.Black();
    this.sunMaterial.specularColor = Color3.Black();
    this.sunMaterial.emissiveColor = new Color3(1, 0.97, 0.85);
    this.sunMaterial.disableLighting = true;
    this.sunMaterial.opacityTexture = createSunDiscTexture(scene); // a soft radial falloff so this reads as a glowing disc, not a hard-edged flat circle
    this.sunMesh.material = this.sunMaterial;
  }

  /**
   * Call once per frame with the DirectionalLight's current `direction`,
   * the current (possibly mid-transition, already-interpolated) weather
   * params, the player's world (x, z) to keep the cloud layer centered
   * overhead, and dt to drive the drift animation.
   */
  update(sunDirection: Vector3, weather: SkyWeatherParams, playerX: number, playerZ: number, dt: number) {
    // The shader wants the sun's *position* in the sky, i.e. the opposite
    // of the direction light travels toward the ground.
    this.material.sunPosition = sunDirection.scale(-100);
    this.material.turbidity = weather.turbidity;
    this.material.luminance = weather.luminance;
    this.material.rayleigh = weather.rayleigh;
    this.material.mieCoefficient = weather.mieCoefficient;

    // Same direction convention as the shader's own sunPosition just
    // above, so the visible disc always sits exactly where the
    // atmospheric glow (and the actual shadow-casting light direction)
    // says the sun is — offset from the player's own position, not just
    // infiniteDistance alone, the same way the cloud layer below
    // re-centers each frame rather than assuming that flag alone keeps
    // a flat mesh correctly positioned as the player roams.
    const sunOffset = sunDirection.scale(-2500); // behind the mountains, not in front of them
    this.sunMesh.position.set(playerX + sunOffset.x, sunOffset.y, playerZ + sunOffset.z);
    // Below the horizon (night) — fade the disc out rather than showing
    // a sun glowing through the ground.
    this.sunMaterial.alpha = sunOffset.y > 0 ? 1 : 0;

    this.cloudMesh.position.x = playerX;
    this.cloudMesh.position.z = playerZ;

    const tex = this.cloudTexture;
    tex.uOffset += dt * CLOUD_DRIFT_SPEED;

    this.cloudMaterial.alpha = weather.cloudCoverage;
    const shade = 1 - weather.cloudDarkness * 0.75; // 1 = bright white, down to 0.25 = dark storm-grey
    this.cloudMaterial.diffuseColor.set(shade, shade, shade);
    this.cloudMaterial.emissiveColor.set(shade * 0.8, shade * 0.8, shade * 0.82);
  }
}
