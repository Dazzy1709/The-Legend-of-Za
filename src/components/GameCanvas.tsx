// src/components/GameCanvas.tsx
import { useEffect, useRef } from "react";
import { GameEngine } from "../babylon/core/GameEngine";
import type { WeaponKind, WorldPosition } from "../types";
import type { BridgeEvents } from "../babylon/core/EventBridge";
import type { SaveGame } from "../../shared/save";
import type { LevelUpEvent, ProgressionSnapshot, WeaponLevelUpEvent } from "../babylon/progression/Progression";

interface GameCanvasProps {
  /** The save to continue from (read once, when the engine starts; null: a new game). */
  save: SaveGame | null;
  /** Picking up after a page refresh: no opening shot (read once, like `save`). */
  resume?: boolean;
  /** True while a dialogue, shop or weapon-wheel overlay is open — freezes player input. */
  paused: boolean;
  onNpcNearbyChange: (npcId: string | null) => void;
  onNpcInteract: (npcId: string) => void;
  onPositionChanged: (position: WorldPosition) => void;
  onDistrictChanged: (districtName: string) => void;
  onWeaponWheelToggled: () => void;
  onWeaponHotkey: (weapon: WeaponKind) => void;
  onAimingChanged: (aiming: boolean) => void;
  onPlayerHealthChanged: (health: { current: number; max: number }) => void;
  onGoldChanged: (amount: number) => void;
  onPlayerDamaged: () => void;
  onPlayerDied: () => void;
  onEnemyDamaged: () => void;
  onProgressionChanged: (snapshot: ProgressionSnapshot) => void;
  onLevelUp: (event: LevelUpEvent) => void;
  onWeaponLevelUp: (event: WeaponLevelUpEvent) => void;
  onInteractableNearby: (nearby: BridgeEvents["interactableNearby"]) => void;
  onScreenFade: (fade: BridgeEvents["screenFade"]) => void;
  onSafeHouseRested: (event: BridgeEvents["safeHouseRested"]) => void;
  onPlayerRespawned: () => void;
  onCutsceneChanged: (event: BridgeEvents["cutsceneChanged"]) => void;
  onRideChanged: (event: BridgeEvents["rideChanged"]) => void;
  engineRef: React.MutableRefObject<GameEngine | null>;
}

export function GameCanvas({
  save,
  resume = false,
  paused,
  onNpcNearbyChange,
  onNpcInteract,
  onPositionChanged,
  onDistrictChanged,
  onWeaponWheelToggled,
  onWeaponHotkey,
  onAimingChanged,
  onPlayerHealthChanged,
  onGoldChanged,
  onPlayerDamaged,
  onPlayerDied,
  onEnemyDamaged,
  onProgressionChanged,
  onLevelUp,
  onWeaponLevelUp,
  onInteractableNearby,
  onScreenFade,
  onSafeHouseRested,
  onPlayerRespawned,
  onCutsceneChanged,
  onRideChanged,
  engineRef,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Mount the engine once. Callbacks are captured at mount time and kept
  // fresh via refs so the engine itself is never recreated on re-render.
  const callbacksRef = useRef({
    onNpcNearbyChange,
    onNpcInteract,
    onPositionChanged,
    onDistrictChanged,
    onWeaponWheelToggled,
    onWeaponHotkey,
    onAimingChanged,
    onPlayerHealthChanged,
    onGoldChanged,
    onPlayerDamaged,
    onPlayerDied,
    onEnemyDamaged,
    onProgressionChanged,
    onLevelUp,
    onWeaponLevelUp,
    onInteractableNearby,
    onScreenFade,
    onSafeHouseRested,
    onPlayerRespawned,
    onCutsceneChanged,
    onRideChanged,
  });
  // Refreshed after every render (refs mustn't be written during render);
  // the bridge listeners below only read it later, from event callbacks.
  useEffect(() => {
    callbacksRef.current = {
      onNpcNearbyChange,
      onNpcInteract,
      onPositionChanged,
      onDistrictChanged,
      onWeaponWheelToggled,
      onWeaponHotkey,
      onAimingChanged,
      onPlayerHealthChanged,
      onGoldChanged,
      onPlayerDamaged,
      onPlayerDied,
      onEnemyDamaged,
      onProgressionChanged,
      onLevelUp,
      onWeaponLevelUp,
      onInteractableNearby,
      onScreenFade,
      onSafeHouseRested,
      onPlayerRespawned,
      onCutsceneChanged,
      onRideChanged,
    };
  });

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new GameEngine(canvasRef.current, { save, resume });
    engineRef.current = engine;

    const offNearby = engine.bridge.on("npcNearby", (id) => callbacksRef.current.onNpcNearbyChange(id));
    const offInteract = engine.bridge.on("npcInteract", (id) => callbacksRef.current.onNpcInteract(id));
    const offPosition = engine.bridge.on("positionChanged", (pos) =>
      callbacksRef.current.onPositionChanged(pos)
    );
    const offDistrict = engine.bridge.on("districtChanged", (name) =>
      callbacksRef.current.onDistrictChanged(name)
    );
    const offWeaponWheel = engine.bridge.on("weaponWheelToggled", () =>
      callbacksRef.current.onWeaponWheelToggled()
    );
    const offWeaponHotkey = engine.bridge.on("weaponHotkey", (weapon) => callbacksRef.current.onWeaponHotkey(weapon));
    const offAiming = engine.bridge.on("aimingChanged", (aiming) =>
      callbacksRef.current.onAimingChanged(aiming)
    );
    const offPlayerHealth = engine.bridge.on("playerHealthChanged", (health) =>
      callbacksRef.current.onPlayerHealthChanged(health)
    );
    const offGold = engine.bridge.on("goldChanged", (amount) => callbacksRef.current.onGoldChanged(amount));
    const offDamaged = engine.bridge.on("playerDamaged", () => callbacksRef.current.onPlayerDamaged());
    const offDied = engine.bridge.on("playerDied", () => callbacksRef.current.onPlayerDied());
    const offEnemyDamaged = engine.bridge.on("enemyDamaged", () => callbacksRef.current.onEnemyDamaged());
    const offProgression = engine.bridge.on("progressionChanged", (p) => callbacksRef.current.onProgressionChanged(p));
    const offLevelUp = engine.bridge.on("levelUp", (e) => callbacksRef.current.onLevelUp(e));
    const offWeaponLevelUp = engine.bridge.on("weaponLevelUp", (e) => callbacksRef.current.onWeaponLevelUp(e));
    const offInteractable = engine.bridge.on("interactableNearby", (n) => callbacksRef.current.onInteractableNearby(n));
    const offFade = engine.bridge.on("screenFade", (f) => callbacksRef.current.onScreenFade(f));
    const offRested = engine.bridge.on("safeHouseRested", (e) => callbacksRef.current.onSafeHouseRested(e));
    const offRespawned = engine.bridge.on("playerRespawned", () => callbacksRef.current.onPlayerRespawned());
    const offCutscene = engine.bridge.on("cutsceneChanged", (e) => callbacksRef.current.onCutsceneChanged(e));
    const offRide = engine.bridge.on("rideChanged", (e) => callbacksRef.current.onRideChanged(e));
    // The engine's first state was set before anyone was listening.
    callbacksRef.current.onProgressionChanged(engine.getProgression());

    return () => {
      offNearby();
      offInteract();
      offPosition();
      offDistrict();
      offWeaponWheel();
      offWeaponHotkey();
      offAiming();
      offPlayerHealth();
      offGold();
      offDamaged();
      offDied();
      offEnemyDamaged();
      offProgression();
      offLevelUp();
      offWeaponLevelUp();
      offInteractable();
      offFade();
      offRested();
      offRespawned();
      offCutscene();
      offRide();
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setInputEnabled(!paused);
  }, [paused, engineRef]);

  return <canvas ref={canvasRef} className="w-full h-full block outline-none touch-none" />;
}
