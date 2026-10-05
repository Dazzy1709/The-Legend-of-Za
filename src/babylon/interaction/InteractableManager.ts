// src/babylon/interaction/InteractableManager.ts
// Things in the world (not people) the player can use with E: a safe
// house door now; later chests, signs, vehicles, travel points. Each one
// is a spot with a radius; the nearest in range is "nearby" (React shows
// the prompt), and E — or the touch prompt — uses it. Talking to an NPC
// takes priority when both are in range, so the two never fight over E.

import { Color3, KeyboardEventTypes, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { WorldPosition } from "../../types";
import type { EventBridge } from "../core/EventBridge";
import { sampleTerrainHeight } from "../world/TerrainBuilder";

export type InteractableKind = "safeHouse" | "vehicle";

export interface Interactable {
  id: string;
  kind: InteractableKind;
  /** Shown in the prompt: "Press E to {action} {label}". */
  label: string;
  action: string;
  position: WorldPosition;
  radius: number;
  /** The floating diamond over the spot (default true) — off for things with their own label. */
  showMarker?: boolean;
}

export interface NearbyInteractable {
  id: string;
  label: string;
  action: string;
}

const MARKER_HEIGHT = 1.6;

export class InteractableManager {
  private entries: { def: Interactable; groundY: number; marker: Mesh; available: boolean }[] = [];
  private markerMat: StandardMaterial;
  private nearbyId: string | null = null;
  private enabled = true;
  private elapsed = 0;

  constructor(
    scene: Scene,
    interactables: Interactable[],
    private getPlayerPosition: () => Vector3,
    private bridge: EventBridge,
    /** True while something else (an NPC to talk to) has E. */
    private isBlocked: () => boolean
  ) {
    this.markerMat = new StandardMaterial("interactable-marker-mat", scene);
    this.markerMat.diffuseColor = Color3.Black();
    this.markerMat.specularColor = Color3.Black();
    this.markerMat.emissiveColor = new Color3(0.35, 1, 0.6);
    this.markerMat.alpha = 0.85;

    for (const def of interactables) this.add(scene, def);

    scene.onKeyboardObservable.add((kbInfo) => {
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN && kbInfo.event.key.toLowerCase() === "e") this.triggerInteract();
    });
  }

  add(scene: Scene, def: Interactable) {
    const groundY = sampleTerrainHeight(def.position.x, def.position.z);
    // A small glowing diamond floating over the spot, like the NPC talk markers.
    const marker = MeshBuilder.CreatePolyhedron(`interactable-marker-${def.id}`, { type: 1, size: 0.16 }, scene);
    marker.material = this.markerMat;
    marker.isPickable = false;
    marker.isVisible = def.showMarker !== false;
    marker.position.set(def.position.x, groundY + MARKER_HEIGHT, def.position.z);
    this.entries.push({ def: { ...def, position: { ...def.position } }, groundY, marker, available: true });
  }

  /** For things that move (a parked vehicle). */
  setPosition(id: string, x: number, z: number) {
    const entry = this.entries.find((e) => e.def.id === id);
    if (!entry) return;
    entry.def.position.x = x;
    entry.def.position.z = z;
    entry.groundY = sampleTerrainHeight(x, z);
    entry.marker.position.x = x;
    entry.marker.position.z = z;
  }

  /** An unavailable one can't be used and gives no prompt (a vehicle someone is riding). */
  setAvailable(id: string, available: boolean) {
    const entry = this.entries.find((e) => e.def.id === id);
    if (entry) entry.available = available;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  getNearbyId(): string | null {
    return this.nearbyId;
  }

  /** Uses whatever is in range — E, or the touch prompt. */
  triggerInteract() {
    if (!this.enabled || !this.nearbyId || this.isBlocked()) return;
    const entry = this.entries.find((e) => e.def.id === this.nearbyId);
    if (entry) this.bridge.emit("interactableUsed", { id: entry.def.id, kind: entry.def.kind });
  }

  update(dt: number) {
    this.elapsed += dt;
    const pos = this.getPlayerPosition();
    let closest: Interactable | null = null;
    let closestDist = Infinity;
    for (const { def, groundY, marker, available } of this.entries) {
      const d = Math.hypot(pos.x - def.position.x, pos.z - def.position.z);
      if (available && d < def.radius && d < closestDist) {
        closest = def;
        closestDist = d;
      }
      marker.rotation.y += dt * 1.6;
      marker.position.y = groundY + MARKER_HEIGHT + Math.sin(this.elapsed * 2.2) * 0.1;
    }
    // An NPC in range wins the prompt (and E).
    const id = closest && !this.isBlocked() ? closest.id : null;
    if (id !== this.nearbyId) {
      this.nearbyId = id;
      this.bridge.emit("interactableNearby", closest && id ? { id, label: closest.label, action: closest.action } : null);
    }
  }
}
