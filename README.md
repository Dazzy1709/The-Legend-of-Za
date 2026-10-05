# The Legend of Zaza

A 3D action RPG built with Babylon.js, React and Vite.

```bash
npm install
npm run dev
```

## Project structure

The code is split three ways:

- **`src/babylon/`** is the engine: how things work.
- **`src/content/`** is the data: what's in the game.
- **`public/assets/`** holds the files: models, textures and sounds.

Adding to the game (a city, a character, an animation, a sound) mostly means adding content and assets, not changing engine code.

```
src/
  babylon/                 engine (Babylon.js), one folder per system
    core/                  GameEngine (owns the scene and main loop), EventBridge (engine <-> React events)
    world/                 terrain, city, sky, weather, grass, trees, textures
    characters/            SkeletalCharacter (rigged models + animation), NPCs, crowds
    player/                PlayerController: movement, camera, combat input
    combat/                damage, enemies, weapons
    progression/           levels, XP, stats, gold
    interaction/           usable things in the world (safe house door, vehicles, ...)
    vehicles/              Budmobile: the flying vehicle
    cutscenes/             CutsceneDirector: plays camera cutscenes
    audio/                 SoundManager
  content/                 game data, no engine logic
    assetPaths.ts          the only place that knows where asset files live
    cities/                one folder per city + the registry (index.ts)
      kushtar/             placements.ts (buildings, NPCs, safe house, spawn), index.ts
    characters/skins.ts    every character model
    animations/            the shared humanoid animation library
    cutscenes/             cutscene camera shots (intro.ts)
    items/                 items and shop prices
    dialogue/              conversations
    audio/sounds.ts        every sound, by id
    vehicles/vehicles.ts   every vehicle: model, size, speeds
    textures/              texture-set lists
  components/              React UI
    hud/                   on-screen during play: HUD, minimap, stats, crosshair, ...
    panels/                menus: inventory, shop, dialogue, combat, weapon wheel
    overlays/              full-screen layers: cutscene bars, fades, death screen, notices
    controls/              touch controls
    shared/                small pieces used everywhere (item icons, ...)
  state/                   React game state (reducer)

public/assets/
  characters/<skin>/       rigged character models (.glb)
  animations/humanoid/     Mixamo animation clips, shared by every character
  weapons/                 weapon models
  textures/<set>/          PBR texture sets
  props/                   trees, rocks, furniture and other world objects
  vehicles/                vehicle models
  sounds/                  music/, sfx/, ambience/
```

## How to add things

| To add a... | Do this |
|---|---|
| **City** | Create `src/content/cities/<id>/` with a `placements.ts` and an `index.ts` exporting a `CityDefinition` (see `cityTypes.ts`), then register it in `src/content/cities/index.ts`. |
| **Character** | Put the rigged `.glb` in `public/assets/characters/<id>/<id>.glb` and add it to `src/content/characters/skins.ts`. It can play every animation in the library right away. |
| **Animation** | Put the Mixamo `.glb` in `public/assets/animations/humanoid/`, then add its name and file in `src/content/animations/humanoidAnimations.ts`. |
| **Weapon** | Put the model in `public/assets/weapons/`, add the kind to `WeaponKind` (`src/types.ts`), and build and attach it in `src/babylon/combat/Weapons.ts`. Guns also get an entry in `GUN_CONFIGS` (`CombatConfig.ts`). |
| **Texture set** | Put it in `public/assets/textures/<name>/textures/` and load it with `createPbrTextureSetMaterial` (`world/PbrTextureSet.ts`). |
| **Prop or tree** | Put the `.glb` in `public/assets/props/` and load it from `PROPS_FOLDER`. |
| **Vehicle or travel** | Put the model in `public/assets/vehicles/<id>/` and describe it in `src/content/vehicles/vehicles.ts`. Another hover vehicle can reuse `babylon/vehicles/Budmobile.ts` (see `GameEngine.createBudmobile`); a new kind of travel gets its own class in `babylon/vehicles/`. |
| **Cutscene** | Add a `CutsceneDefinition` in `src/content/cutscenes/` (see `intro.ts`) and play it through `CutsceneDirector` (`GameEngine.playIntro` shows how). |
| **Sound** | Put the file in `public/assets/sounds/<category>/`, register it in `src/content/audio/sounds.ts`, then call `gameEngine.playSound(id)`. |
| **Item** | Add it to `src/content/items/strains.ts`, and its icon style to `components/shared/ItemIcon.tsx`. |
| **NPC or conversation** | Place the NPC in the city's `placements.ts`, then add the dialogue tree to `src/content/dialogue/dialogueTrees.ts`. |
