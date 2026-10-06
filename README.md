# The Legend of Zaza

A 3D action RPG built with Babylon.js, React and Vite.

```bash
npm install
npm run dev
```

`npm run dev` starts the game (http://localhost:5173) and the game backend (`server/`, on port 8787) together. You start at the main menu, sign up or log in, and your progress saves to your account. To keep accounts and saves on the device instead, put `VITE_BACKEND=local` in `.env.local` (see `.env.example`).

Security, privacy and the App Store checklist are in [SECURITY.md](SECURITY.md). The privacy policy is in [PRIVACY.md](PRIVACY.md).

## Project structure

The code is split five ways:

- **`src/babylon/`** is the engine: how things work.
- **`src/content/`** is the data: what's in the game.
- **`public/assets/`** holds the files: models, textures and sounds.
- **`src/services/`** talks to the outside world: the backend, saving, settings.
- **`server/` and `shared/`** are the backend, plus the code the game and backend both use.

Adding to the game (a city, a character, an animation, a mission, a cutscene, a sound) mostly means adding content and assets, not changing engine code.

```
shared/                    used by BOTH the game and the server
  save.ts                  the save-file schema (versioned, with migrations)
  api.ts                   the API contract: routes, requests/responses, account rules
server/                    the game backend (Node, no dependencies) — npm run server
  index.ts                 HTTP routes: sign up / log in / log out, save, export, delete account
  auth.ts                  password hashing, sessions
  rateLimit.ts             brute-force / abuse limits
  store.ts                 the database (a JSON file — swap for Postgres/Supabase here)
src/
  babylon/                 engine (Babylon.js), one folder per system
    core/                  GameEngine (owns the scene and main loop), EventBridge (engine <-> React events)
    world/                 terrain, city, wilds (forests/rocks), sky, weather, grass, textures
    characters/            SkeletalCharacter (rigged models + animation), NPCs, crowds
    player/                PlayerController: movement, camera, combat input
    combat/                damage, enemies, weapons
    progression/           levels, XP, stats, gold
    interaction/           usable things in the world (safe house door, vehicles, ...)
    vehicles/              Budmobile: the flying vehicle
    cutscenes/             CutsceneDirector (plays cutscenes), types.ts (what a cutscene is)
    story/                 MissionManager: story missions, objectives, rewards
    speech/                speech bubbles and barks (Barker)
    audio/                 SoundManager
  content/                 game data, no engine logic
    assetPaths.ts          the only place that knows where asset files live
    cities/                one folder per city + the registry (index.ts)
      kushtar/             placements.ts (buildings, NPCs, safe house, spawn), index.ts
    characters/skins.ts    every character model
    animations/            the shared humanoid animation library
    cutscenes/             every cutscene: shots/ (orbit, path, sequence), system/, story/ — see its README
    story/missions.ts      the story, mission by mission
    legal/                 the privacy policy text
    items/                 items and shop prices, weapons for sale (weapons.ts)
    dialogue/              conversations (dialogueTrees.ts) and shouted lines (barks.ts)
    audio/sounds.ts        every sound, by id
    vehicles/vehicles.ts   every vehicle: model, size, speeds
    textures/              texture-set lists
  components/              React UI
    hud/                   on-screen during play: HUD, minimap, stats, crosshair, ...
    panels/                menus: inventory, shop, dialogue, combat, weapon wheel
    overlays/              full-screen layers: cutscene bars, fades, death screen, notices
    controls/              touch controls
    shared/                small pieces used everywhere (item icons, ...)
  screens/                 whole screens: menu/ (main menu, sign in, account), GameScreen
  services/
    backend/               GameBackend: online (HttpBackend → server/) or on-device (LocalBackend)
    save/                  builds a save from the game's state, and back
    settings/              player preferences (look sensitivity, volume, ...)
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
| **Sound** | Put the file in `public/assets/sounds/<category>/`, register it in `src/content/audio/sounds.ts`, then call `gameEngine.playSound(id)`. |
| **Weapon in the Weapons Store** | Add it to `WEAPON_STORE` in `src/content/items/weapons.ts` with a price and, optionally, a story flag it waits for (`requiresFlag`). Starting weapons are `STARTING_WEAPONS` there. |
| **Item** | Add it to `src/content/items/strains.ts`, and its icon style to `components/shared/ItemIcon.tsx`. |
| **Shouted lines (speech bubbles)** | Add lines to a voice in `src/content/dialogue/barks.ts`, or add a new voice and set an enemy archetype's `voice` (`CombatConfig.ts`). Anything can talk with `new Barker(speechBubbles, id, voice, anchor).bark(trigger)` or `speechBubbles.say(id, anchor, text)`. |
| **Mission** | Append it to `STORY` in `src/content/story/missions.ts`: its objectives (talk, rest, ride, defeat, goTo), rewards, and optionally start and end cutscenes. A new objective kind goes in `Objective` and gets a handler in `babylon/story/MissionManager.ts`. |
| **Story cutscene** | See `src/content/cutscenes/README.md`. In short: build it from `orbitShot`, `pathShot` or `sequence` in `story/<chapter>.ts`, register it in `cutscenes/index.ts`, and play it from a mission. |
| **Saved data** | Add the field to `SaveGame` (`shared/save.ts`) and bump `SAVE_VERSION` with a migration. Write it in `GameEngine.exportState` or `services/save/SaveSystem.ts`, and read it in `GameEngine.applySave`. |
| **Backend** | Implement the routes in `shared/api.ts` on any server, or replace `server/store.ts` with a real database. The game only talks to the `GameBackend` interface. |
| **Main menu entry** | Add it to `items` in `src/screens/menu/MainMenu.tsx` and handle its id in `choose`. |
| **Setting** | Add it to `GameSettings` (`src/services/settings/settings.ts`), apply it in `GameEngine.applySettings`, and add a control in `components/overlays/PauseMenu.tsx`. |
| **NPC or conversation** | Place the NPC in the city's `placements.ts`, then add the dialogue tree to `src/content/dialogue/dialogueTrees.ts`. |
