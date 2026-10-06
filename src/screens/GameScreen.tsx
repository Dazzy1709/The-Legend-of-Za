// src/screens/GameScreen.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useGameState } from "../state/useGameState";
import { GameEngine } from "../babylon/core/GameEngine";
import { GameCanvas } from "../components/GameCanvas";
import { HUD } from "../components/hud/HUD";
import { DialogueBox } from "../components/panels/DialogueBox";
import { InventoryPanel } from "../components/panels/InventoryPanel";
import { ShopPanel } from "../components/panels/ShopPanel";
import { WeaponStorePanel } from "../components/panels/WeaponStorePanel";
import { MissionPassed, type MissionPassedInfo } from "../components/overlays/MissionPassed";
import { MISSION_PASSED_MS } from "../babylon/story/MissionManager";
import { InteractionPrompt } from "../components/hud/InteractionPrompt";
import { Crosshair } from "../components/hud/Crosshair";
import { WeaponWheelOverlay } from "../components/panels/WeaponWheelOverlay";
import { VirtualJoystick } from "../components/controls/VirtualJoystick";
import { MobileActionButtons } from "../components/controls/MobileActionButtons";
import { Minimap } from "../components/hud/Minimap";
import { ComboTimer, ReloadTimer } from "../components/hud/TimerRings";
import { AmmoCounter } from "../components/hud/AmmoCounter";
import { NPC_PLACEMENTS } from "../content/cities/kushtar/placements";
import { STRAINS, STRAIN_PRICES } from "../content/items/strains";
import { dialogueTreeFor } from "../content/dialogue/dialogueTrees";
import { LevelUpBanner, type LevelUpNotice } from "../components/overlays/LevelUpBanner";
import { CutsceneOverlay } from "../components/overlays/CutsceneOverlay";
import { ScreenFade } from "../components/overlays/ScreenFade";
import { DeathScreen } from "../components/overlays/DeathScreen";
import { StatsPanel } from "../components/hud/StatsPanel";
import { CoinToast, type CoinPickup } from "../components/hud/CoinToast";
import type { BridgeEvents } from "../babylon/core/EventBridge";
import type { LevelUpEvent, ProgressionSnapshot, WeaponLevelUpEvent } from "../babylon/progression/Progression";

/** How long the "Picked up N coins" box stays after the last pickup (ms). */
const COIN_TOAST_MS = 2200;
/** How long each level-up message stays up (ms). */
const LEVEL_NOTICE_MS = 4500;
const WEAPON_LABELS: Record<WeaponKind, string> = { sword: "Sword", pickaxe: "Pickaxe", gun: "Gun" };
const STAT_LABELS = { strength: "Strength", endurance: "Endurance", cardio: "Cardio", defense: "Defense" } as const;
import type { WeaponKind } from "../types";
import type { SaveGame } from "../../shared/save";
import { buildSave, uiStateFromSave } from "../services/save/SaveSystem";
import { PauseMenu } from "../components/overlays/PauseMenu";
import { loadSettings, storeSettings, type GameSettings } from "../services/settings/settings";
import { ObjectiveTracker } from "../components/hud/ObjectiveTracker";
import { TutorialTips } from "../components/hud/TutorialTips";
import { SaveIndicator, type SaveState } from "../components/hud/SaveIndicator";
import type { MissionStatus } from "../babylon/story/MissionManager";

function isTouchDevice(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
}

/** How often the game saves on its own, besides the moments that trigger a save. */
const AUTOSAVE_SECONDS = 60;
/** Event-triggered saves closer together than this are folded into one. */
const MIN_SECONDS_BETWEEN_SAVES = 8;

interface GameScreenProps {
  /** The save to continue from; null starts a new game. */
  initialSave: SaveGame | null;
  username: string;
  /** Persists a save (to this device or the server — the shell decides). */
  onSave: (save: SaveGame, options?: { keepalive?: boolean }) => Promise<void>;
  onExitToMenu: () => void;
  /** How far the initial load has got (for the loading screen, which the shell shows). */
  onLoadingProgress: (progress: BridgeEvents["loadingProgress"]) => void;
  /** Picking up after a page refresh: straight back in, no opening shot. */
  resume?: boolean;
}

export default function GameScreen({ initialSave, username, onSave, onExitToMenu, onLoadingProgress, resume = false }: GameScreenProps) {
  const {
    state,
    talkToNpc,
    chooseDialogue,
    openInventory,
    closeInventory,
    consumeStrain,
    clearMessage,
    setPosition,
    showMessage,
    openWeaponWheel,
    closeWeaponWheel,
    equipWeapon,
    syncPlayerHealth,
    addGold,
    buyStrain,
    buyWeapon,
    moveInventoryItem,
  } = useGameState(initialSave ? uiStateFromSave(initialSave) : null);

  const engineRef = useRef<GameEngine | null>(null);
  const [nearbyNpcId, setNearbyNpcId] = useState<string | null>(null);
  const [isAiming, setIsAiming] = useState(false);
  const [touchDevice] = useState(isTouchDevice);
  // A counter, not a boolean — used as the flash overlay's own React
  // key below, so each hit forces a fresh remount (and therefore
  // restarts the CSS fade-out from scratch) even if hits land in rapid
  // succession, rather than a boolean that can't "re-trigger" on a
  // value that's already true.
  const [damageFlash, setDamageFlash] = useState(0);
  const [hitmarkerFlash, setHitmarkerFlash] = useState(0);
  const [showDeathScreen, setShowDeathScreen] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [showWeaponStore, setShowWeaponStore] = useState(false);
  const [progression, setProgression] = useState<ProgressionSnapshot | null>(null);
  const [levelNotices, setLevelNotices] = useState<LevelUpNotice[]>([]);
  // The game opens on the intro cutscene (not when resuming after a
  // refresh), from a black screen — both set here too, since the engine
  // announces them before React is listening.
  const [cutscene, setCutscene] = useState<BridgeEvents["cutsceneChanged"]>(
    resume ? { id: null, active: false, letterbox: false, skippable: false } : { id: "intro", active: true, letterbox: true, skippable: true }
  );
  const [screenFade, setScreenFade] = useState<BridgeEvents["screenFade"]>({ opacity: 1, durationMs: 0 });
  const [nearbyInteractable, setNearbyInteractable] = useState<BridgeEvents["interactableNearby"]>(null);
  const [ride, setRide] = useState<BridgeEvents["rideChanged"]>({ state: "parked", canDismount: false });
  const riding = ride.state === "riding";
  const noticeIdRef = useRef(0);

  const pushLevelNotice = useCallback((notice: Omit<LevelUpNotice, "id">) => {
    const id = ++noticeIdRef.current;
    setLevelNotices((list) => [...list, { ...notice, id }]);
    setTimeout(() => setLevelNotices((list) => list.filter((n) => n.id !== id)), LEVEL_NOTICE_MS);
  }, []);

  // "Level 5" + what each stat went up to.
  const handleLevelUp = useCallback(
    (e: LevelUpEvent) =>
      pushLevelNotice({
        tone: "level",
        title: `Level ${e.level}!`,
        lines: [
          ...e.changes.map((c) => `${STAT_LABELS[c.stat]} ${c.from} → ${c.to}`),
          `Max health ${e.maxHealthFrom} → ${e.maxHealthTo}`,
        ],
      }),
    [pushLevelNotice]
  );
  const handleWeaponLevelUp = useCallback(
    (e: WeaponLevelUpEvent) =>
      pushLevelNotice({
        tone: "weapon",
        title: `${WEAPON_LABELS[e.weapon]} — level ${e.level}`,
        lines: [`Damage ${e.damageFrom} → ${e.damageTo}`],
      }),
    [pushLevelNotice]
  );

  // "The user can move while the inventory is open" — but not the shop,
  // which still pauses movement. Inventory mode is deliberately
  // excluded from the pause check here, unlike every other non-explore
  // mode (dialogue, weaponWheel), which still fully pause.
  // ---------- Saving ----------
  // The latest UI state, for saves started from timers and engine events.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const lastSaveAt = useRef(0);
  const saveIndicatorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveNow = useCallback(async (): Promise<boolean> => {
    const engine = engineRef.current;
    if (!engine) return false;
    lastSaveAt.current = performance.now();
    setSaveState("saving");
    let ok = true;
    try {
      await onSave(buildSave(engine.exportState(), stateRef.current));
    } catch {
      ok = false;
    }
    setSaveState(ok ? "saved" : "error");
    if (saveIndicatorTimer.current) clearTimeout(saveIndicatorTimer.current);
    saveIndicatorTimer.current = setTimeout(() => setSaveState("idle"), ok ? 1800 : 4000);
    return ok;
  }, [onSave]);
  // Moments that matter (resting, mission progress, level-ups) save right
  // away; otherwise every AUTOSAVE_SECONDS.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const off = engine.bridge.on("requestSave", ({ reason }) => {
      if (reason === "rest" || performance.now() - lastSaveAt.current > MIN_SECONDS_BETWEEN_SAVES * 1000) void saveNow();
    });
    const timer = setInterval(() => void saveNow(), AUTOSAVE_SECONDS * 1000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [saveNow]);
  // Refreshing or closing the page saves the very latest state, so a
  // refresh picks up exactly where the player was. (keepalive lets the
  // request finish after the page is gone.)
  useEffect(() => {
    const onPageHide = () => {
      const engine = engineRef.current;
      if (engine) void onSave(buildSave(engine.exportState(), stateRef.current), { keepalive: true }).catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [onSave]);

  // ---------- Loading ----------
  useEffect(() => engineRef.current?.bridge.on("loadingProgress", onLoadingProgress), [onLoadingProgress]);

  // ---------- Story ----------
  // "Mission Passed" at the end of a chapter — shown for MISSION_PASSED_MS.
  // Missions within a chapter just get a toast.
  const [missionPassed, setMissionPassed] = useState<MissionPassedInfo | null>(null);
  const [mission, setMission] = useState<MissionStatus | null>(null);
  const [caption, setCaption] = useState<{ speaker: string | null; text: string } | null>(null);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setMission(engine.getMissionStatus());
    const offs = [
      engine.bridge.on("missionChanged", setMission),
      engine.bridge.on("cutsceneCaption", setCaption),
      engine.bridge.on("missionCompleted", (m) => {
        if (m.chapterEnd) setMissionPassed({ id: performance.now(), chapter: m.chapter, xp: m.chapterXp, gold: m.chapterGold });
        else showMessage(`✓ ${m.title}${m.xp > 0 ? ` · +${m.xp} XP` : ""}`);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [showMessage]);
  useEffect(() => {
    if (!missionPassed) return;
    const t = setTimeout(() => setMissionPassed(null), MISSION_PASSED_MS);
    return () => clearTimeout(t);
  }, [missionPassed]);

  // ---------- Pause menu & settings ----------
  const [menuOpen, setMenuOpen] = useState(false);
  // Esc opens it (closing is the menu's own Esc handling).
  useEffect(() => {
    if (menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || engineRef.current?.isCutscenePlaying()) return;
      if (state.mode !== "explore") return; // Escape belongs to the open panel
      setMenuOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.mode, menuOpen]);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  useEffect(() => {
    engineRef.current?.applySettings(settings);
    storeSettings(settings);
  }, [settings]);
  useEffect(() => {
    if (menuOpen) document.exitPointerLock?.();
  }, [menuOpen]);
  const handleQuit = useCallback(async () => {
    await saveNow();
    onExitToMenu();
  }, [saveNow, onExitToMenu]);

  const paused = (state.mode !== "explore" && state.mode !== "inventory") || showShop || showWeaponStore || menuOpen;
  const nearbyNpcName = nearbyNpcId
    ? NPC_PLACEMENTS.find((n) => n.id === nearbyNpcId)?.name ?? null
    : null;

  // Only act on an interact key-press while actually exploring — the engine
  // also gates this itself via setInputEnabled, this is a second guard.
  const handleInteract = useCallback(
    (npcId: string) => {
      if (state.mode !== "explore") return;
      if (npcId === "healing-shop") {
        setShowShop(true);
        return;
      }
      if (npcId === "weapons-store") {
        setShowWeaponStore(true);
        return;
      }
      const placement = NPC_PLACEMENTS.find((n) => n.id === npcId);
      const engine = engineRef.current;
      if (!placement || !engine) return;
      const treeId = dialogueTreeFor(npcId, placement.dialogueTreeId, (flag) => engine.hasStoryFlag(flag));
      engine.addStoryFlag(`talked:${treeId}`);
      talkToNpc(npcId, treeId);
    },
    [state.mode, talkToNpc]
  );

  const handleDistrictChanged = useCallback(
    (districtName: string) => showMessage(`Entering ${districtName}`),
    [showMessage]
  );

  const handleWeaponWheelToggled = useCallback(() => {
    if (state.mode !== "explore") return;
    openWeaponWheel();
  }, [state.mode, openWeaponWheel]);

  const handlePlayerHealthChanged = useCallback(
    (health: { current: number; max: number }) => syncPlayerHealth(health.current, health.max),
    [syncPlayerHealth]
  );
  // Coins picked up show in a little box; pickups within a couple of
  // seconds of each other add up in the same box.
  const [coinPickup, setCoinPickup] = useState<CoinPickup | null>(null);
  const coinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleGoldChanged = useCallback(
    (amount: number) => {
      addGold(amount);
      if (amount <= 0) return;
      setCoinPickup((prev) => ({ id: (prev?.id ?? 0) + 1, amount: (prev?.amount ?? 0) + amount }));
      if (coinTimerRef.current) clearTimeout(coinTimerRef.current);
      coinTimerRef.current = setTimeout(() => setCoinPickup(null), COIN_TOAST_MS);
    },
    [addGold]
  );
  const handlePlayerDamaged = useCallback(() => setDamageFlash((n) => n + 1), []);
  const handleEnemyDamaged = useCallback(() => setHitmarkerFlash((n) => n + 1), []);
  // "YOU DIED" stays up until the engine has respawned the player.
  const handlePlayerDied = useCallback(() => setShowDeathScreen(true), []);
  const handlePlayerRespawned = useCallback(() => setShowDeathScreen(false), []);
  const handleSafeHouseRested = useCallback(
    () => pushLevelNotice({ tone: "rest", title: "Fully rested", lines: ["Your health has been restored to full."] }),
    [pushLevelNotice]
  );
  const handleSkipCutscene = useCallback(() => engineRef.current?.skipCutscene(), []);
  const handleUseHealingLeaf = useCallback(
    (strainId: string) => {
      const strain = STRAINS[strainId];
      if (!strain) return;
      // Both sides updated together: consumeStrain decrements the reducer's
      // own inventory count (the thing genuinely owned there), and
      // healPlayer applies the actual heal to the real-time combat
      // system's own health — which then emits its own
      // playerHealthChanged, syncing player.hp back to the true new
      // value rather than this handler trying to compute it itself.
      // A heal can't revive the player (PlayerController.heal() refuses
      // while dead), so don't spend the item on one that would do nothing.
      if (strain.effect.kind === "heal" && state.player.hp <= 0) return;
      consumeStrain(strainId);
      if (strain.effect.kind === "heal") {
        engineRef.current?.healPlayer(strain.effect.amount);
      } else if (strain.effect.kind === "statBuff") {
        engineRef.current?.applyStatBuff(strain.effect.stat, strain.effect.amount, strain.effect.seconds, strain.name);
      }
    },
    [consumeStrain, state.player.hp]
  );

  // Buying from the shop gives a little XP (half the price) — only for a
  // purchase that actually goes through.
  const handleBuyStrain = useCallback(
    (strainId: string) => {
      const price = STRAIN_PRICES[strainId];
      if (price !== undefined && state.player.gold >= price) engineRef.current?.grantPurchaseXp(price);
      buyStrain(strainId);
    },
    [buyStrain, state.player.gold]
  );

  // Finishing a conversation gives a very small amount of XP (once per
  // person per couple of minutes — see Progression.grantInteractionXp).
  const handleChooseDialogue = useCallback(
    (choiceId: string) => {
      const dialogue = state.activeDialogue;
      const choice = dialogue?.tree.nodes[dialogue.nodeId]?.choices.find((c) => c.id === choiceId);
      if (dialogue && choice && !choice.nextNodeId) engineRef.current?.grantInteractionXp(dialogue.tree.npcId);
      chooseDialogue(choiceId);
    },
    [chooseDialogue, state.activeDialogue]
  );

  // The reducer's `equippedWeapon` is the source of truth for the UI (HUD
  // icon, wheel highlight); the engine call is what actually attaches the
  // 3D weapon model to the player's hand. Both need to happen together —
  // neither one alone is enough.
  // Only owned weapons equip — the gun is bought at the Weapons Store.
  const handleWeaponSelect = useCallback(
    (weapon: WeaponKind) => {
      if (!state.ownedWeapons.includes(weapon)) {
        closeWeaponWheel();
        showMessage("You don't have that yet. Weapons are sold at the Weapons Store in the Handelsviertel.");
        return;
      }
      engineRef.current?.setEquippedWeapon(weapon);
      equipWeapon(weapon);
    },
    [equipWeapon, state.ownedWeapons, showMessage, closeWeaponWheel]
  );

  const handleWeaponUnequip = useCallback(() => {
    engineRef.current?.setEquippedWeapon(null);
    equipWeapon(null);
  }, [equipWeapon]);

  // A loaded game puts its saved weapon back in the player's hand.
  useEffect(() => {
    engineRef.current?.setEquippedWeapon(stateRef.current.equippedWeapon);
  }, []);

  // 1/2/3 — same toggle behavior as clicking a HUD dock slot: picking the
  // already-equipped weapon holsters it.
  const handleWeaponHotkey = useCallback(
    (weapon: WeaponKind) => {
      if (state.equippedWeapon === weapon) handleWeaponUnequip();
      else handleWeaponSelect(weapon);
    },
    [state.equippedWeapon, handleWeaponSelect, handleWeaponUnequip]
  );

  // Touch control handlers — each just forwards to the engine, which
  // simulates the equivalent keyboard input (or, for the joystick, drives
  // movement directly), so none of PlayerController's actual input logic
  // needed to change to support mobile.
  const handleJoystickMove = useCallback((x: number, z: number) => {
    engineRef.current?.setVirtualMove(x, z);
  }, []);
  const handleJumpChange = useCallback((pressed: boolean) => {
    engineRef.current?.setJumpHeld(pressed);
  }, []);
  const handleAttackChange = useCallback((pressed: boolean) => {
    engineRef.current?.setAttackHeld(pressed);
  }, []);
  const handleAimTap = useCallback(() => {
    engineRef.current?.triggerAimToggle();
  }, []);
  const handleInteractTap = useCallback(() => {
    engineRef.current?.triggerInteract();
  }, []);

  useEffect(() => {
    if (!state.message) return;
    const t = setTimeout(clearMessage, 2500);
    return () => clearTimeout(t);
  }, [state.message, clearMessage]);

  useEffect(() => {
    engineRef.current?.setTalkingNpc(state.mode === "dialogue" ? state.activeDialogue?.tree.npcId ?? null : null);
  }, [state.mode, state.activeDialogue]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-stone-950 font-sans text-stone-100">
      <div className="absolute inset-0">
        <GameCanvas
          save={initialSave}
          resume={resume}
          paused={paused}
          engineRef={engineRef}
          onNpcNearbyChange={setNearbyNpcId}
          onNpcInteract={handleInteract}
          onPositionChanged={setPosition}
          onDistrictChanged={handleDistrictChanged}
          onWeaponWheelToggled={handleWeaponWheelToggled}
          onWeaponHotkey={handleWeaponHotkey}
          onAimingChanged={setIsAiming}
          onPlayerHealthChanged={handlePlayerHealthChanged}
          onGoldChanged={handleGoldChanged}
          onPlayerDamaged={handlePlayerDamaged}
          onPlayerDied={handlePlayerDied}
          onEnemyDamaged={handleEnemyDamaged}
          onProgressionChanged={setProgression}
          onLevelUp={handleLevelUp}
          onWeaponLevelUp={handleWeaponLevelUp}
          onInteractableNearby={setNearbyInteractable}
          onScreenFade={setScreenFade}
          onSafeHouseRested={handleSafeHouseRested}
          onPlayerRespawned={handlePlayerRespawned}
          onCutsceneChanged={setCutscene}
          onRideChanged={setRide}
        />
      </div>

      {/* A brief red vignette flash on taking damage — key={damageFlash}
          forces a fresh remount (and therefore a restarted CSS
          transition) on every hit, even several in quick succession,
          since a boolean state wouldn't "re-trigger" on a value that's
          already true. Radial gradient (strong at the edges, clear at
          center) rather than a flat overlay — a flat color at a
          visible-enough opacity to actually read as "you got hit"
          would otherwise obscure the middle of the screen, exactly
          where the player needs to keep seeing what's attacking them.
          pointer-events-none throughout — it must never block clicks/
          input underneath it. */}
      <div
        key={`damage-${damageFlash}`}
        className={damageFlash === 0 ? "hidden" : "pointer-events-none fixed inset-0 z-30 opacity-0 [animation:damage-flash_550ms_ease-out] [background:radial-gradient(ellipse_at_center,transparent_35%,rgba(220,38,38,0.85)_100%)]"}
      />

      {/* Hitmarker — a Call of Duty-style "X" flash at screen center the
          instant the player's own attack actually lands on an enemy
          (enemyDamaged, the same event driving the camera shake).
          key={hitmarkerFlash} forces a fresh remount on every landed
          hit, same reasoning as the damage flash above. */}
      <svg
        key={`hitmarker-${hitmarkerFlash}`}
        viewBox="0 0 40 40"
        className={hitmarkerFlash === 0 ? "hidden" : "pointer-events-none fixed left-1/2 top-1/2 z-30 h-8 w-8 -translate-x-1/2 -translate-y-1/2 opacity-0 [animation:hitmarker-flash_200ms_ease-out]"}
      >
        <line x1="6" y1="6" x2="16" y2="16" stroke="white" strokeWidth="3" strokeLinecap="round" />
        <line x1="34" y1="6" x2="24" y2="16" stroke="white" strokeWidth="3" strokeLinecap="round" />
        <line x1="6" y1="34" x2="16" y2="24" stroke="white" strokeWidth="3" strokeLinecap="round" />
        <line x1="34" y1="34" x2="24" y2="24" stroke="white" strokeWidth="3" strokeLinecap="round" />
      </svg>

      {showDeathScreen && <DeathScreen />}

      <LevelUpBanner notices={levelNotices} />

      {/* The HUD and everything else placed around the screen's edges sits
          in the safe frame, clear of a phone's notch and home indicator. */}
      <div className="safe-frame z-20">
      {/* Everything on screen during play. Hidden while a cutscene runs,
          and faded back in once it's over. */}
      {!cutscene.active && (
        <div className="[animation:hud-in_600ms_ease-out]">
        <div className="absolute top-0 left-0 right-0 z-10">
          <HUD
            player={state.player}
            equippedWeapon={state.equippedWeapon}
            ownedWeapons={state.ownedWeapons}
            onOpenInventory={openInventory}
            onSelectWeapon={handleWeaponSelect}
            onUnequipWeapon={handleWeaponUnequip}
            onUseHealingLeaf={handleUseHealingLeaf}
            progression={progression}
            engineRef={engineRef}
            onOpenMenu={() => setMenuOpen(true)}
          />
        </div>

        {/* On touch devices the interact prompt is itself the button (no
            keyboard to press E on) — see InteractionPrompt's onTap. */}
        <InteractionPrompt
          label={state.mode !== "explore" ? null : riding ? (ride.canDismount ? "the Budmobile" : null) : nearbyNpcName ?? nearbyInteractable?.label ?? null}
          action={riding ? "get off" : nearbyNpcName ? "talk to" : nearbyInteractable?.action}
          onTap={handleInteractTap}
        />

        {state.mode === "explore" && <Crosshair />}

        {state.mode === "explore" && <ComboTimer engineRef={engineRef} />}

        {state.mode === "explore" && <ReloadTimer engineRef={engineRef} />}

        {state.mode === "explore" && <AmmoCounter engineRef={engineRef} />}

        {/* Bottom-right; on touch screens that corner has the action buttons, so it sits top-right instead. */}
        {/* On touch screens (and short ones) it's shrunk, under the gold and Bag. */}
        {state.mode === "explore" && <Minimap engineRef={engineRef} className={`${touchDevice ? "top-28 right-3" : "bottom-4 right-4"} compact:bottom-auto! compact:right-2! compact:top-[3.25rem]! compact:origin-top-right! compact:scale-[0.62]!`} />}

        {state.mode === "explore" && progression && (
          <StatsPanel progression={progression} className={`${touchDevice ? "bottom-44 left-3" : "bottom-4 left-4"} compact:hidden!`} showKeyHint={!touchDevice} />
        )}

        {state.mode === "explore" && touchDevice && (
          <>
            <VirtualJoystick onMove={handleJoystickMove} />
            <MobileActionButtons
              onJumpChange={handleJumpChange}
              onAttackChange={handleAttackChange}
              onAimTap={handleAimTap}
              aiming={isAiming}
            />
          </>
        )}

        {state.mode === "explore" && riding && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-stone-900/70 px-3 py-1.5 text-xs text-stone-300">
            {touchDevice ? "Stick to fly · Jump to climb · Attack to sink" : "WASD fly · Space climb · C sink · Shift boost"}
            {!ride.canDismount && <span className="text-emerald-300"> · Land to get off</span>}
          </div>
        )}

        {state.mode === "explore" && !touchDevice && ride.state === "parked" && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-stone-400 text-xs bg-stone-900/70 px-3 py-1.5 rounded-full">
            F to {state.equippedWeapon === "gun" ? "fire" : state.equippedWeapon ? "swing" : "punch"}
            {state.equippedWeapon === "gun" ? " · R to toggle aim · G to reload" : ""} · Q to change weapon
          </div>
        )}
        </div>
      )}

      {!cutscene.active && <CoinToast pickup={coinPickup} />}

      {!cutscene.active && state.mode === "explore" && <ObjectiveTracker status={mission} />}
      {!cutscene.active && !missionPassed && state.mode === "explore" && mission && mission.tips.length > 0 && (
        <TutorialTips
          key={`${mission.missionId}-${mission.step}`}
          objectiveKey={`${mission.missionId}-${mission.step}`}
          tips={mission.tips}
          touch={touchDevice}
        />
      )}

      <SaveIndicator state={saveState} />

      {state.message && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-stone-800 border border-amber-900/40 text-amber-200 text-sm px-4 py-2 rounded-full shadow-lg z-30">
          {state.message}
        </div>
      )}

      {state.mode === "dialogue" && state.activeDialogue && (
        <DialogueBox
          tree={state.activeDialogue.tree}
          nodeId={state.activeDialogue.nodeId}
          onChoose={handleChooseDialogue}
        />
      )}
      </div>

      {menuOpen && (
        <PauseMenu
          username={username}
          saveState={saveState}
          settings={settings}
          onChangeSettings={setSettings}
          onResume={() => setMenuOpen(false)}
          onSave={() => void saveNow()}
          onQuitToMenu={() => void handleQuit()}
        />
      )}

      {cutscene.active && (
        <CutsceneOverlay letterbox={cutscene.letterbox} caption={caption} skippable={cutscene.skippable} touch={touchDevice} onSkip={handleSkipCutscene} />
      )}

      <ScreenFade opacity={screenFade.opacity} durationMs={screenFade.durationMs} />

      {state.mode === "inventory" && (
        <InventoryPanel player={state.player} onUseStrain={handleUseHealingLeaf} onMoveItem={moveInventoryItem} onClose={closeInventory} />
      )}

      {missionPassed && !cutscene.active && <MissionPassed key={missionPassed.id} info={missionPassed} />}
      {showWeaponStore && (
        <WeaponStorePanel
          gold={state.player.gold}
          owned={state.ownedWeapons}
          hasFlag={(flag) => engineRef.current?.hasStoryFlag(flag) ?? false}
          onBuy={(weapon) => {
            buyWeapon(weapon);
            setShowWeaponStore(false);
          }}
          onClose={() => setShowWeaponStore(false)}
        />
      )}
      {showShop && (
        <ShopPanel player={state.player} onBuyStrain={handleBuyStrain} onClose={() => setShowShop(false)} />
      )}

      {state.mode === "weaponWheel" && (
        <WeaponWheelOverlay
          equipped={state.equippedWeapon}
          owned={state.ownedWeapons}
          onSelect={handleWeaponSelect}
          onUnequip={handleWeaponUnequip}
          onClose={closeWeaponWheel}
          weapons={progression?.weapons}
        />
      )}
    </div>
  );
}