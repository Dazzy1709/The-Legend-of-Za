# Cutscenes

```
cutscenes/
  index.ts      the registry: every cutscene by id
  shots/        camera building blocks
    orbit.ts      circle a point of interest
    path.ts       glide along a list of camera positions / look-at points
    sequence.ts   cut several shots together into one cutscene
    handover.ts   the glide into the gameplay camera every cutscene ends with
    easing.ts     easing curves
  system/       game-flow cutscenes (the load-in shot at start and after respawn)
  story/        story cutscenes, one file per chapter
```

A cutscene (`babylon/cutscenes/types.ts`) is made of:
- **A camera move.**
- **Subtitles** (`captions`, with an optional speaker).
- **A timeline of events** (`events`): fades, sounds, story flags, speech bubbles over NPCs.

To add a new kind of event, add it to `CutsceneEvent` and handle it in `GameEngine.handleCutsceneEvent`.

## Adding a cutscene

1. **Build it:** add it to a chapter file in `story/`, using `orbitShot`, `pathShot` or a `sequence` of them. Inside a sequence, give each shot `handover: false`.
2. **Register it:** add it to `CUTSCENES` in `index.ts`.
3. **Play it:**
   - From a mission, set `startCutscene` / `endCutscene` in `content/story/missions.ts`.
   - From code, call `gameEngine.playCutscene(id)`.
   - Story cutscenes are remembered once seen, and that is saved with the game.
