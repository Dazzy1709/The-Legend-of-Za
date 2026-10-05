// src/babylon/characters/NPCManager.ts
import { AbstractMesh, KeyboardEventTypes, Scene, ShadowGenerator, Sprite, SpriteManager, Vector3 } from "@babylonjs/core";
import type { NPCPlacement } from "../../types";
import { type NinjaAnimation, SkeletalCharacter } from "./SkeletalCharacter";
import { PlayerController } from "../player/PlayerController";
import { EventBridge } from "../core/EventBridge";
import { sampleTerrainHeight } from "../world/TerrainBuilder";
import { createNameLabelAtlas, createTalkableMarkerTexture } from "../world/TextureFactory";

const INTERACT_RADIUS = 2.5;
const MARKER_BOB_SPEED = 2.2;
const MARKER_HEIGHT = 2.3; // above the NPC's feet
const NAME_LABEL_HEIGHT = 2.75; // above the marker, so both are visible without overlapping
const NAME_LABEL_CELL_WIDTH = 180;
const NAME_LABEL_CELL_HEIGHT = 40;
const TALKING_CLIPS: NinjaAnimation[] = ["talking1", "talking2", "talking3"];

// A 1x1 transparent PNG — SpriteManager needs an initial image URL, which we
// immediately replace with our procedurally generated marker texture below.
const BLANK_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

interface NPCEntry {
  placement: NPCPlacement;
  /** Nullable — the skinned model loads asynchronously; the marker/interaction radius work immediately regardless. */
  character: SkeletalCharacter | null;
  marker: Sprite;
  /** The NPC's real name, always shown — unlike CrowdManager's ambient crowd, which now shows a character type instead, every one of these is someone the player can actually talk to. */
  nameLabel: Sprite;
  bobPhase: number;
  groundY: number;
  /** Picked once per dialogue session so a conversation doesn't visibly restart the clip every frame. */
  talkingClip: NinjaAnimation;
}

/**
 * Interactive, named, talkable villagers — Snoop, Mary Jane, and the rest
 * of the cast. They stand in place (no wander AI) so they're reliable
 * landmarks for dialogue, built from the same skinned character models
 * as the crowd (each placement picks its own skin). Each shows a small floating marker sprite
 * (createTalkableMarkerTexture) so the player can tell from a distance
 * which characters can actually be spoken to — CrowdManager's purely
 * decorative background villagers have no marker and no interaction.
 * Plays an idle loop normally, and switches to one of three "talking"
 * clips for whichever NPC the player is actively in dialogue with (see
 * setTalkingNpc, driven from React's dialogue state via GameEngine).
 */
export class NPCManager {
  private entries: NPCEntry[] = [];
  private nearbyId: string | null = null;
  private enabled = true;
  private talkingNpcId: string | null = null;

  constructor(
    scene: Scene,
    placements: NPCPlacement[],
    private player: PlayerController,
    private bridge: EventBridge,
    shadows?: ShadowGenerator
  ) {
    // One shared atlas built directly from this cast's own real names —
    // not a random pick from a name pool the way CrowdManager's old
    // (now-removed) name labels worked, since every one of these needs
    // to show its own specific, correct name, not just any name.
    // cellIndex below is that same placements array index, since
    // createNameLabelAtlas lays out cell i for names[i].
    const nameLabelManager = new SpriteManager(
      "npcNameLabels",
      BLANK_PIXEL,
      placements.length,
      { width: NAME_LABEL_CELL_WIDTH, height: NAME_LABEL_CELL_HEIGHT },
      scene
    );
    nameLabelManager.texture = createNameLabelAtlas(
      scene,
      placements.map((p) => p.name),
      NAME_LABEL_CELL_WIDTH,
      NAME_LABEL_CELL_HEIGHT
    );

    placements.forEach((placement, i) => {
      const groundY = sampleTerrainHeight(placement.position.x, placement.position.z);
      const talkingClip = TALKING_CLIPS[i % TALKING_CLIPS.length];

      const entry: NPCEntry = {
        placement,
        character: null,
        marker: null as unknown as Sprite, // assigned just below, before this entry is ever read
        nameLabel: null as unknown as Sprite, // assigned just below, before this entry is ever read
        bobPhase: i * 1.7,
        groundY,
        talkingClip,
      };

      SkeletalCharacter.create(scene, `npc-${placement.id}`, ["idle", talkingClip], placement.skin).then((character) => {
        character.position = new Vector3(placement.position.x, groundY, placement.position.z);
        if (shadows) character.addShadowCasters((m: AbstractMesh) => shadows.addShadowCaster(m));
        entry.character = character;
      }).catch((err) => {
        // Most commonly: the scene was disposed mid-load (a fast unmount —
        // React StrictMode's dev-mode double-invoke does this on every
        // initial mount). entry.character just stays null; nothing else
        // depends on this NPC's model existing.
        console.warn(`NPC "${placement.id}" character failed to load:`, err);
      });

      const markerManager = new SpriteManager(`npcMarkerMgr-${placement.id}`, BLANK_PIXEL, 1, 32, scene);
      markerManager.texture = createTalkableMarkerTexture(scene);
      const marker = new Sprite(`npc-marker-${placement.id}`, markerManager);
      marker.width = 0.7;
      marker.height = 0.7;
      marker.invertV = true;
      marker.position = new Vector3(placement.position.x, groundY + MARKER_HEIGHT, placement.position.z);
      entry.marker = marker;

      const nameLabel = new Sprite(`npc-name-${placement.id}`, nameLabelManager);
      nameLabel.cellIndex = i;
      nameLabel.height = 0.5;
      nameLabel.width = nameLabel.height * (NAME_LABEL_CELL_WIDTH / NAME_LABEL_CELL_HEIGHT);
      nameLabel.invertV = true;
      nameLabel.position = new Vector3(placement.position.x, groundY + NAME_LABEL_HEIGHT, placement.position.z);
      entry.nameLabel = nameLabel;

      this.entries.push(entry);
    });

    scene.onKeyboardObservable.add((kbInfo) => {
      if (!this.enabled) return;
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN && kbInfo.event.key.toLowerCase() === "e") {
        if (this.nearbyId) this.bridge.emit("npcInteract", this.nearbyId);
      }
    });
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  /** The talkable NPC in range, if any. */
  getNearbyId(): string | null {
    return this.nearbyId;
  }

  /** Same effect as pressing E — used by the on-screen interact button on touch devices, which have no keyboard. */
  triggerInteract() {
    if (this.nearbyId) this.bridge.emit("npcInteract", this.nearbyId);
  }

  /** Called from GameEngine whenever the active dialogue's NPC changes (including to/from null when dialogue closes). */
  setTalkingNpc(npcId: string | null) {
    this.talkingNpcId = npcId;
  }

  /** Call once per frame from the render loop. */
  update(dt: number) {
    const pos = this.player.getPosition();
    let closest: string | null = null;
    let closestDist = Infinity;

    for (const entry of this.entries) {
      // Distance uses the placement's fixed position, not the character's
      // — these NPCs never move, and this keeps the interaction radius
      // working correctly even in the moment before the model finishes
      // loading.
      const d = Vector3.Distance(pos, new Vector3(entry.placement.position.x, entry.groundY, entry.placement.position.z));
      if (d < INTERACT_RADIUS && d < closestDist) {
        closest = entry.placement.id;
        closestDist = d;
      }

      if (entry.character) {
        entry.character.update(dt);
        const talking = this.talkingNpcId === entry.placement.id;
        entry.character.play(talking ? entry.talkingClip : "idle");
      }

      // Gentle bob on the marker so it reads as an active indicator, not a
      // static decal.
      entry.bobPhase += dt * MARKER_BOB_SPEED;
      entry.marker.position.y = entry.groundY + MARKER_HEIGHT + Math.sin(entry.bobPhase) * 0.12;
    }

    if (closest !== this.nearbyId) {
      this.nearbyId = closest;
      this.bridge.emit("npcNearby", closest);
    }
  }
}