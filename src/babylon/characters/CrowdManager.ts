// src/babylon/characters/CrowdManager.ts
// Purely decorative background villagers — no dialogue, no interaction
// radius, no bridge events, and no talkable marker (that's what visually
// separates them from NPCManager's cast). Built from the same real skinned
// ninja rig as the player: each one picks a random spot within a short
// radius of its spawn point, walks there with actual animated legs/arms
// (not a sprite flipbook) and a real turn to face the direction it's
// walking, pauses, and picks another.
//
// Two other behaviors live in this same class now, selected per-instance
// via the trailing `mode` constructor option (default "wander", so every
// existing call site is unaffected):
//
// - "streetWalk": instead of a short local wander, each member picks a
//   distant point on the city's own street grid and walks there via a
//   simple two-leg, sidewalk-offset path (follow one grid line, turn,
//   follow the other) — this is what actually crosses the whole city
//   rather than staying near one spawn point, and is what "some NPCs
//   walk through the entire city, using the sidewalks/streets" means in
//   practice: real grid-following travel, not a wider wander radius.
//
// - Conversations (an independent `enableConversations` option, only
//   meaningful for "wander" groups): when a member's wander pause
//   starts, it has a chance to find another currently-paused member of
//   the *same* group nearby, pair up, turn to face each other, and play
//   a talking-loop animation together for a few seconds before both
//   resume wandering — "some NPCs talk to each other" as an actual
//   two-character animated exchange, not just two people standing near
//   each other. Scoped to within one CrowdManager instance rather than
//   across the whole city's worth of separate instances — each group is
//   already spatially clustered around one shared home point, so a
//   same-instance partner is already "nearby" without needing any
//   cross-instance registry.
//
// Each crowd member also gets a random name (in the same playful,
// cannabis-culture-adjacent style the game's own named NPCs already use
// — Snoop Cordozar, Mary Jane, Olaf Kush, etc.) and shows their last
// name floating above their head. The name-label texture is a single
// shared atlas (createNameLabelAtlas, TextureFactory.ts) built once and
// reused via SpriteManager/Sprite.cellIndex — with hundreds of crowd
// members across the city, a separate DynamicTexture per NPC would be
// real GPU memory pressure; this caps it at one shared texture no matter
// how many NPCs exist, since NPCs that happen to share a last name
// literally share the same sprite cell.

import { Ray, Scene, ShadowGenerator, Sprite, SpriteManager, Vector3 } from "@babylonjs/core";
import { QUALITY, scaledCount } from "../core/Quality";
import { CELL_SIZE, CITY_SPAN, RING_ROAD_RADIUS } from "../world/CityBuilder";
import { type CharacterSkinId, SkeletalCharacter } from "./SkeletalCharacter";
import { sampleTerrainHeight } from "../world/TerrainBuilder";
import { createNameLabelAtlas } from "../world/TextureFactory";

export type CrowdMode = "wander" | "streetWalk";

/** Crowd members farther than this from the player are switched off (hidden, not animated) — the city is far bigger than what's visible around you. */
export const CHARACTER_ACTIVE_RADIUS = 70;
const WALK_SPEED = 1.4; // units/sec — deliberately slower than the player, for local wander
// Keyed per-Scene via WeakMap, not a single module-level counter — a
// bare `let` counter never resets: React StrictMode deliberately
// mounts a scene, tears it down, then mounts a real one as a dev-mode
// sanity check, and the old counter kept climbing straight through
// that instead of restarting — so the surviving scene's own NPCs
// inherited an already-inflated delay from the discarded first mount,
// compounding further on every subsequent remount/hot-reload, pushing
// real character creation later and later. A WeakMap entry per Scene
// means each new scene genuinely starts its own stagger at 0.
const crowdSpawnStaggerByScene = new WeakMap<Scene, number>();
function nextStaggerDelay(scene: Scene): number {
  const count = crowdSpawnStaggerByScene.get(scene) ?? 0;
  crowdSpawnStaggerByScene.set(scene, count + 1);
  return count * 25;
}
const STREET_WALK_SPEED = 1.6; // a bit brisker than local wander — these read as actually going somewhere, not idly milling about
const ARRIVE_THRESHOLD = 0.3;
const MAX_PATH_ATTEMPTS = 5; // how many candidate wander/streetWalk targets to try before giving up and staying put this cycle, rather than accepting one that cuts through a building
const PAUSE_MIN = 1.5;
const PAUSE_MAX = 4.5;
const TAUNT_CHANCE = 0.15; // lower than Enemy.ts's own 0.3 — ambient crowd NPCs taunting/insulting each other is a flavor touch, not something that should dominate every pause the way it more plausibly could for actual hostile enemies
const TAUNT_DURATION_ESTIMATE = 2.5;
const STREET_PAUSE_MIN = 0.8; // shorter pause between legs of a cross-city walk — they're travelling, not lingering
const STREET_PAUSE_MAX = 2.2;
const TURN_EASE_RATE = 6; // how fast the character eases its facing toward the movement direction
const MIN_SCALE = 0.85; // some size variety since every crowd member is now the same model/mesh
/**
 * Weighted NPC skin distribution — men/women split an even 65% (32.5%
 * each, since "men and women 65%" wasn't broken down further), wizard
 * 15%, warriorFemale 10%, seller 5%. These sum to 95, not 100 (as given)
 * — pickNpcSkin normalizes against their actual total rather than
 * assuming they sum to exactly 100, so the relative proportions still
 * come out right regardless. "ninja" is deliberately never in this
 * list — that model is reserved for the player character only.
 */
// men/women/warriorFemale/warriorMale/wizard/seller — each confirmed to
// actually exist, one folder per skin under public/assets/characters/<skin>/,
// matching every other character in this project.
// The original probabilities, restored exactly as first set ("the
// probabilities I mentioned way back in the chat") rather than the
// rescaled-to-fit-100 version watcher's addition produced — watcher is
// now gone entirely (replaced by warriorMale, per request), and
// warriorMale is given the same weight as warriorFemale for symmetry
// between the two.
const NPC_SKIN_WEIGHTS: { skin: CharacterSkinId; weight: number }[] = [
  { skin: "men", weight: 32.5 },
  { skin: "women", weight: 32.5 },
  { skin: "wizard", weight: 15 },
  { skin: "warriorFemale", weight: 10 },
  { skin: "warriorMale", weight: 10 },
  { skin: "seller", weight: 5 },
];
const NPC_SKIN_TOTAL_WEIGHT = NPC_SKIN_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);

function pickNpcSkin(seed01: number): CharacterSkinId {
  let cursor = seed01 * NPC_SKIN_TOTAL_WEIGHT;
  for (const entry of NPC_SKIN_WEIGHTS) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.skin;
  }
  return NPC_SKIN_WEIGHTS[NPC_SKIN_WEIGHTS.length - 1].skin;
}

const MAX_SCALE = 1.05;
const NAME_LABEL_HEIGHT = 2.1; // above the NPC's feet
const NAME_LABEL_CELL_WIDTH = 140;
const NAME_LABEL_CELL_HEIGHT = 40;

// How far a streetWalk member's path sits offset from the street's own
// centerline — reads as walking along the sidewalk rather than straight
// down the middle of the road. Not tied to CityBuilder's own exact
// sidewalk mesh width on purpose: this is an approximate, procedural
// walking line, not a physically-collided path, so it only needs to
// read correctly, not match to the centimeter.
const STREET_SIDEWALK_OFFSET = 3;

// Conversation tuning. A pause beginning is the only moment a
// conversation can start (see startPause) — CONVERSATION_CHANCE is
// rolled once right there, not continuously, so it isn't re-rolled every
// frame of a long pause.
const CONVERSATION_CHANCE = 0.35;
const CONVERSATION_SEEK_RADIUS = 6;
const CONVERSATION_MIN = 3;
const CONVERSATION_MAX = 6;

// Kept separate from world3d.ts's named-NPC list on purpose — this pool
// is for the ambient crowd specifically, so the two casts don't overlap
// or risk a background villager sharing a name with an actual quest NPC.
/** Shown over ambient crowd NPCs' heads instead of a name — only NPCs the player can actually talk to (NPCManager's named cast) keep real names above them. Each label is derived directly from its skin's own folder/file name (splitting camelCase into words and capitalizing), not a separately invented role name — "warriorFemale" reads as "Warrior Female", not an unrelated word like "Warrior" on its own. */
function skinDisplayName(skinId: CharacterSkinId): string {
  return skinId
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase -> "camel Case"
    .replace(/^./, (c) => c.toUpperCase()); // capitalize the first letter
}
const NPC_TYPE_LABELS = NPC_SKIN_WEIGHTS.map((entry) => skinDisplayName(entry.skin));

function typeLabelForSkin(skinId: CharacterSkinId): string {
  return skinDisplayName(skinId);
}

/**
 * The shared name-label sprite manager/atlas — built once, the first
 * time any CrowdManager is constructed, and reused by every instance
 * after that (module-level, not per-CrowdManager) so the whole city's
 * worth of crowd groups still only ever needs the one shared texture.
 */
// A 1x1 transparent PNG data URI — SpriteManager's constructor needs an
// image URL up front, but this manager's real texture (the name atlas)
// is assigned immediately after via `.texture =`, same pattern
// NPCManager's own marker SpriteManager already uses. An inline data URI
// loads instantly with no network request, unlike an empty string which
// risks a load error before the real texture replaces it.
const BLANK_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

/**
 * Keyed per-Scene (WeakMap, not a bare module-level singleton) — this is
 * the exact same StrictMode double-mount problem NinjaAssets (in
 * SkeletalCharacter.ts) already had to solve, and missing it here is
 * why the names weren't showing up at all: React's dev-mode double-
 * invoke mounts GameCanvas (and the GameEngine/Scene it creates) twice
 * on the very first render, disposing the first one almost immediately.
 * A bare module-level variable doesn't know that happened — the first,
 * short-lived scene's CrowdManager would build the shared SpriteManager
 * and cache it globally, and every CrowdManager in the *second*,
 * actually-live scene would then keep reusing that reference, which is
 * attached to a scene that no longer exists. A WeakMap keyed by the
 * actual Scene instance means each scene gets its own independent
 * shared manager, and a disposed scene's entry is simply never reused.
 */
const nameSpriteManagers = new WeakMap<Scene, SpriteManager>();

function getTypeLabelSpriteManager(scene: Scene): SpriteManager {
  const existing = nameSpriteManagers.get(scene);
  if (existing) return existing;
  const atlas = createNameLabelAtlas(scene, NPC_TYPE_LABELS, NAME_LABEL_CELL_WIDTH, NAME_LABEL_CELL_HEIGHT);
  const manager = new SpriteManager(
    "crowdTypeLabels",
    BLANK_PIXEL,
    2000, // generous capacity — shared across every CrowdManager instance in the city
    { width: NAME_LABEL_CELL_WIDTH, height: NAME_LABEL_CELL_HEIGHT },
    scene
  );
  manager.texture = atlas;
  nameSpriteManagers.set(scene, manager);
  return manager;
}

interface CrowdEntry {
  /** Nullable — the skinned model loads asynchronously; movement tracking below never depends on it being ready. */
  character: SkeletalCharacter | null;
  /** Source of truth for position — was `entry.character.position` before, but that can't be read/written before the model has loaded. */
  position: Vector3;
  home: { x: number; z: number };
  radius: number;
  /** The remaining stops on the current trip, visited in order (shift the front off as each is reached). Empty means "not currently moving" — the single unifying condition both wander (at most 1 waypoint) and streetWalk (up to 2, for the two legs of its L-shaped path) share, rather than each needing its own separate "am I moving" representation. */
  waypoints: { x: number; z: number }[];
  pauseTimer: number;
  facingYaw: number;
  moving: boolean;
  nameLabel: Sprite;
  /** Set only while actively swapped into a conversation with another entry of the *same* CrowdManager instance — see maybeStartConversation. Non-null overrides normal pause/wander behavior: facing tracks the partner instead of easing toward a movement direction, and the idle animation is replaced with a talking loop. */
  conversationPartner: CrowdEntry | null;
  conversationTimer: number;
  /** Which of the two talking clips (talking1/talking2) this entry uses when conversing — picked once per entry, deterministically, so a given crowd slot doesn't flicker between the two across separate conversations. */
  talkingClip: "talking1" | "talking2";
}

function seedFor(x: number, z: number): number {
  const s = Math.sin(x * 91.345 + z * 47.853) * 12543.897;
  return s - Math.floor(s);
}

/** Snaps a world coordinate to the nearest street-grid line. */
function nearestGridLine(v: number): number {
  return Math.round(v / CELL_SIZE) * CELL_SIZE;
}

export class CrowdManager {
  private entries: CrowdEntry[] = [];
  private instanceTag: string;
  private mode: CrowdMode;
  private enableConversations: boolean;

  /**
   * Scatters `count` villagers within `radius` of `center`, avoiding a
   * small clearance around the center itself. `mode` (default "wander")
   * and `enableConversations` (default false, and only meaningful for
   * "wander") are trailing options so every existing call site — which
   * only ever passed the first five, positional arguments — keeps
   * working unchanged.
   */
  constructor(
    private scene: Scene,
    center: { x: number; z: number },
    radius: number,
    count: number,
    clearance = 3,
    shadows?: ShadowGenerator,
    mode: CrowdMode = "wander",
    enableConversations = false
  ) {
    count = scaledCount(count, QUALITY.crowdScale); // fewer on phones — see Quality.ts
    this.instanceTag = `${center.x.toFixed(0)}-${center.z.toFixed(0)}-${mode}`;
    this.mode = mode;
    this.enableConversations = enableConversations && mode === "wander";
    const typeLabelManager = getTypeLabelSpriteManager(scene);
    const preload: Parameters<typeof SkeletalCharacter.create>[2] = this.enableConversations
      ? ["idle", "walkForward", "talking1", "talking2", "taunt", "insult"]
      : ["idle", "walkForward", "taunt", "insult"];

    for (let i = 0; i < count; i++) {
      const seed = seedFor(i * 17.3 + center.x, i * 5.1 + center.z);
      const angle = seed * Math.PI * 2;
      const dist = clearance + seedFor(i * 3.7 + center.x, i * 11.2 + center.z) * (radius - clearance);
      const x = center.x + Math.sin(angle) * dist;
      const z = center.z + Math.cos(angle) * dist;
      const groundY = sampleTerrainHeight(x, z);
      const scaleVariation = MIN_SCALE + seedFor(i * 41.3 + center.x, i * 23.1 + center.z) * (MAX_SCALE - MIN_SCALE);

      // Which base model this entry uses — a weighted pick (not the
      // uniform 1-in-6 this replaced), and never "ninja": that model is
      // reserved for the player character only, per request. Same
      // deterministic-seed pattern as everything else here, so a given
      // crowd slot keeps the same skin across reloads.
      const skinSeed = seedFor(i * 83.7 + center.x, i * 19.3 + center.z);
      const skinId = pickNpcSkin(skinSeed);

      // The label shown over this entry's head — its character type
      // (Civilian/Noble/Wizard/Warrior/Merchant), not a name. Only
      // NPCManager's named, interactable cast shows real names; ambient
      // crowd members like this one aren't individually talkable, so a
      // name would promise an interaction that isn't actually there.
      const typeLabel = typeLabelForSkin(skinId);
      const typeLabelIndex = NPC_TYPE_LABELS.indexOf(typeLabel);

      const talkingClipSeed = seedFor(i * 97.1 + center.x, i * 31.7 + center.z);

      const nameLabel = new Sprite(`crowd-name-${this.instanceTag}-${i}`, typeLabelManager);
      nameLabel.cellIndex = typeLabelIndex;
      // World-unit size for the label, not pixels — matches the scale
      // other billboard markers in this project (NPCManager's talkable
      // marker) use. Width follows the cell's own aspect ratio so the
      // text doesn't stretch.
      nameLabel.height = 0.24; // was 0.38, before that 0.55 — smaller still, per follow-up request
      nameLabel.width = nameLabel.height * (NAME_LABEL_CELL_WIDTH / NAME_LABEL_CELL_HEIGHT);
      // Same DynamicTexture-sourced-sprite pattern NPCManager's own
      // marker uses, including this — without it the text renders
      // vertically flipped.
      nameLabel.invertV = true;
      nameLabel.position = new Vector3(x, groundY + NAME_LABEL_HEIGHT, z);

      const entry: CrowdEntry = {
        character: null,
        position: new Vector3(x, groundY, z),
        home: center,
        radius,
        waypoints: [],
        pauseTimer: seedFor(i * 7.1, i * 2.3) * PAUSE_MAX, // stagger initial pauses so they don't all start moving at once
        facingYaw: seed * Math.PI * 2,
        moving: false,
        nameLabel,
        conversationPartner: null,
        conversationTimer: 0,
        talkingClip: talkingClipSeed < 0.5 ? "talking1" : "talking2",
      };

      // Staggered, not fired immediately — every NPC in every crowd
      // group across the whole city used to call SkeletalCharacter.
      // create() (a GLB load plus several animation retargets, all
      // genuinely CPU-heavy) in the same synchronous instant at scene
      // construction. With dozens of these across all the district
      // groups plus the plaza, that meant dozens of concurrent loads
      // and retargets competing for the main thread and network at
      // once — a real, confirmed cause of "everything takes forever to
      // load." nextStaggerDelay(scene) (not the local i) spreads this
      // across every NPC in the whole city, not just this one group's
      // own handful, and resets cleanly per Scene — see its own
      // comment for why that per-scene reset actually matters.
      const staggerDelay = nextStaggerDelay(scene);
      setTimeout(() => {
        SkeletalCharacter.create(scene, `crowd-${this.instanceTag}-${i}`, preload, skinId).then((character) => {
          character.root.scaling.scaleInPlace(scaleVariation);
          character.position = entry.position.clone();
          character.setFacing(entry.facingYaw);
          if (shadows) character.addShadowCasters((m) => shadows.addShadowCaster(m));
          entry.character = character;
        }).catch((err) => {
          // Most commonly: the scene was disposed mid-load (a fast unmount —
          // React StrictMode's dev-mode double-invoke does this on every
          // initial mount). entry.character just stays null; the wander
          // logic already tolerates that.
          console.warn(`Crowd member ${i} character failed to load:`, err);
        });
      }, staggerDelay);

      this.entries.push(entry);
    }
  }

  /** Call once per frame. `playerPos` decides which members are near enough to draw and animate. */
  update(dt: number, playerPos: Vector3) {
    for (const entry of this.entries) {
      const near = Math.abs(entry.position.x - playerPos.x) < CHARACTER_ACTIVE_RADIUS && Math.abs(entry.position.z - playerPos.z) < CHARACTER_ACTIVE_RADIUS;
      if (entry.conversationPartner) {
        this.updateConversation(entry, dt);
      } else if (entry.waypoints.length > 0) {
        this.moveToward(entry, dt);
      } else {
        entry.pauseTimer -= dt;
        if (entry.pauseTimer <= 0) {
          if (this.enableConversations && Math.random() < CONVERSATION_CHANCE) {
            this.tryStartConversation(entry);
          }
          // tryStartConversation may have consumed this pause into a
          // conversation instead (conversationPartner now set) — only
          // hand it a fresh trip if it didn't.
          if (!entry.conversationPartner) {
            // A random taunt/insult, in place of immediately walking
            // off — per request, "for every npc," not just enemies.
            // Extends this same pause (rather than picking waypoints
            // now) so the clip is actually visible before movement
            // resumes; the next time pauseTimer reaches 0 it goes
            // through this same check again; picking waypoints wins
            // if the roll fails or the character isn't loaded yet.
            const tauntRoll = Math.random();
            if (tauntRoll < TAUNT_CHANCE && entry.character) {
              entry.character.play(tauntRoll < TAUNT_CHANCE / 2 ? "taunt" : "insult", false);
              entry.pauseTimer = TAUNT_DURATION_ESTIMATE;
            } else {
              entry.waypoints = this.pickWaypoints(entry);
              // pickWaypoints can come back empty (every candidate it
              // tried was blocked by a building) — without resetting the
              // pause timer here too, pauseTimer stays <= 0 and this
              // whole block, raycasts included, would re-run every single
              // frame until a clear path happens to turn up. A short,
              // ordinary-length pause instead means a stuck entry just
              // looks like it's idling for a moment, not spinning on
              // failed path attempts.
              if (entry.waypoints.length === 0) {
                entry.pauseTimer = PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
              }
            }
          }
        }
        entry.moving = false;
      }

      // Far away: keep walking their routes (cheap), but don't draw or animate them.
      entry.character?.setActive(near);
      entry.nameLabel.isVisible = near;
      if (entry.character && near) {
        entry.character.position = entry.position;
        entry.character.update(dt);
        entry.character.play(entry.conversationPartner ? entry.talkingClip : entry.moving ? "walkForward" : "idle");
      }

      entry.nameLabel.position.x = entry.position.x;
      entry.nameLabel.position.y = entry.position.y + NAME_LABEL_HEIGHT;
      entry.nameLabel.position.z = entry.position.z;
    }
  }

  /** Wander mode: a single nearby point. StreetWalk mode: a distant grid intersection, reached via a two-leg, sidewalk-offset path along the street grid rather than a straight line through whatever buildings happen to be between here and there. */
  /**
   * Wander mode: a single nearby point. StreetWalk mode: a distant grid
   * intersection, reached via a two-leg, sidewalk-offset path along the
   * street grid rather than a straight line through whatever buildings
   * happen to be between here and there.
   *
   * Each candidate is validated against actual building geometry (see
   * isWaypointPathClear) before being accepted, retrying up to
   * MAX_PATH_ATTEMPTS times — previously nothing here checked buildings
   * at all, so a wander/streetWalk target could sit on the far side of
   * one, or a leg could cut straight through one, with nothing stopping
   * the entry from walking directly through it to get there. Falls back
   * to an empty path (stays put this cycle, tries again at the next
   * pause) if no clear candidate turns up in that many tries, rather
   * than eventually walking through a wall anyway.
   */
  private pickWaypoints(entry: CrowdEntry): { x: number; z: number }[] {
    for (let attempt = 0; attempt < MAX_PATH_ATTEMPTS; attempt++) {
      const candidate = this.mode === "streetWalk" ? this.pickStreetWalkPath(entry) : this.pickWanderPoint(entry);
      if (this.isWaypointPathClear(entry.position, candidate)) return candidate;
    }
    return [];
  }

  private pickWanderPoint(entry: CrowdEntry): { x: number; z: number }[] {
    const seed = Math.random();
    const angle = seed * Math.PI * 2;
    const dist = Math.random() * entry.radius;
    return [{ x: entry.home.x + Math.sin(angle) * dist, z: entry.home.z + Math.cos(angle) * dist }];
  }

  /** Casts a ray, at roughly torso height, from `from` to `to` — true only if nothing named "building-*" (every procedural/bespoke building in the city uses this prefix, see CityBuilder's buildOne/buildPalace/buildRathaus/buildLibrary) sits anywhere along that straight line. */
  private isPathClear(from: { x: number; z: number }, to: { x: number; z: number }): boolean {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const origin = new Vector3(from.x, 1, from.z);
    const direction = new Vector3(dx / dist, 0, dz / dist);
    const ray = new Ray(origin, direction, dist);
    const hit = this.scene.pickWithRay(ray, (mesh) => mesh.name.startsWith("building-"));
    return !hit?.hit;
  }

  /** Validates every leg of a multi-waypoint path (streetWalk's own two-leg L path included), not just the final destination — a corner-to-corner leg needs to be clear too, not just start-to-corner. */
  private isWaypointPathClear(start: { x: number; z: number }, waypoints: { x: number; z: number }[]): boolean {
    let from = start;
    for (const wp of waypoints) {
      if (!this.isPathClear(from, wp)) return false;
      from = wp;
    }
    return true;
  }

  /**
   * A random destination intersection somewhere else on the city's
   * street grid, reached by a simple two-leg "L" path: first along
   * whichever grid line is nearest the current position (offset
   * sideways so this reads as the sidewalk, not the road's centerline),
   * then a turn onto the destination's own cross line for the final
   * approach. Not real pathfinding — it doesn't route around buildings
   * mid-leg — but since both legs run along actual street/sidewalk
   * lines and only turn at an intersection, it reads as someone
   * following the streets across the city rather than cutting straight
   * through blocks, which is the actual point.
   */
  private pickStreetWalkPath(entry: CrowdEntry): { x: number; z: number }[] {
    const half = Math.floor(CITY_SPAN / CELL_SIZE);
    const startGridX = nearestGridLine(entry.position.x);
    // Streets end at the ring road inside the wall, so both the corner and
    // the destination have to lie inside it — retry until they do.
    const limit = RING_ROAD_RADIUS - 4;
    for (let attempt = 0; attempt < 10; attempt++) {
      const destGridX = (Math.floor(Math.random() * (half * 2 + 1)) - half) * CELL_SIZE;
      const destGridZ = (Math.floor(Math.random() * (half * 2 + 1)) - half) * CELL_SIZE;
      const corner = { x: startGridX + STREET_SIDEWALK_OFFSET, z: destGridZ };
      const dest = { x: destGridX, z: destGridZ + STREET_SIDEWALK_OFFSET };
      if (Math.hypot(corner.x, corner.z) < limit && Math.hypot(dest.x, dest.z) < limit) return [corner, dest];
    }
    return [];
  }

  /**
   * Looks for another currently-paused, not-already-conversing member of
   * this same group within CONVERSATION_SEEK_RADIUS. If one's found,
   * pairs them symmetrically (both get the same conversationTimer and
   * point at each other) rather than only setting state on `entry` —
   * the partner's own update() loop needs conversationPartner set too,
   * or only one of the pair would actually turn/play the talking
   * animation while the other kept idling.
   */
  private tryStartConversation(entry: CrowdEntry) {
    let best: CrowdEntry | null = null;
    let bestDist = CONVERSATION_SEEK_RADIUS;
    for (const other of this.entries) {
      if (other === entry) continue;
      if (other.waypoints.length > 0 || other.conversationPartner) continue;
      const d = Vector3.Distance(entry.position, other.position);
      if (d < bestDist) {
        best = other;
        bestDist = d;
      }
    }
    if (!best) return;

    const duration = CONVERSATION_MIN + Math.random() * (CONVERSATION_MAX - CONVERSATION_MIN);
    entry.conversationPartner = best;
    entry.conversationTimer = duration;
    best.conversationPartner = entry;
    best.conversationTimer = duration;
  }

  /** Turns to face the partner (both entries do this independently, so they end up facing each other) and counts down; resets both back to normal wandering once the timer runs out on either side. */
  private updateConversation(entry: CrowdEntry, dt: number) {
    const partner = entry.conversationPartner;
    if (!partner) return;

    entry.conversationTimer -= dt;
    if (entry.conversationTimer <= 0 || partner.conversationPartner !== entry) {
      entry.conversationPartner = null;
      entry.pauseTimer = 0.4; // a short beat before wandering off again, not an instant walk-away
      return;
    }

    const dx = partner.position.x - entry.position.x;
    const dz = partner.position.z - entry.position.z;
    if (Math.hypot(dx, dz) < 0.01) return;
    const targetYaw = Math.atan2(dx, dz);
    let yawDelta = targetYaw - entry.facingYaw;
    yawDelta = Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));
    entry.facingYaw += yawDelta * Math.min(1, dt * TURN_EASE_RATE);
    entry.character?.setFacing(entry.facingYaw);
  }

  private moveToward(entry: CrowdEntry, dt: number) {
    const target = entry.waypoints[0];
    if (!target) return;

    const dx = target.x - entry.position.x;
    const dz = target.z - entry.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < ARRIVE_THRESHOLD) {
      entry.waypoints.shift();
      if (entry.waypoints.length === 0) {
        entry.pauseTimer =
          this.mode === "streetWalk"
            ? STREET_PAUSE_MIN + Math.random() * (STREET_PAUSE_MAX - STREET_PAUSE_MIN)
            : PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
        entry.moving = false;
      }
      return;
    }

    entry.moving = true;
    const speed = this.mode === "streetWalk" ? STREET_WALK_SPEED : WALK_SPEED;
    const step = Math.min(dist, speed * dt);
    const nx = entry.position.x + (dx / dist) * step;
    const nz = entry.position.z + (dz / dist) * step;
    entry.position.set(nx, sampleTerrainHeight(nx, nz), nz);

    // Ease the facing yaw toward the movement direction rather than
    // snapping — a real turn, not an instant flip.
    const targetYaw = Math.atan2(dx, dz);
    let yawDelta = targetYaw - entry.facingYaw;
    // wrap to [-PI, PI] so the character always turns the short way
    yawDelta = Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));
    entry.facingYaw += yawDelta * Math.min(1, dt * TURN_EASE_RATE);
    entry.character?.setFacing(entry.facingYaw);
  }
}