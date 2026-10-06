// src/state/useGameState.ts
// A single predictable reducer drives the whole game — cheap to re-render,
// easy to reason about, and easy to save/load (just serialize `state`).
// Movement and world placement now live in the Babylon layer; this reducer
// owns RPG state only: health/gold mirror, dialogue, inventory, quest flags.

import { useCallback, useMemo, useReducer } from "react";
import type {
  DialogueTree,
  GameMode,
  InventoryEntry,
  PlayerState,
  WeaponKind,
  WorldPosition,
} from "../types";
import { DIALOGUE_TREES } from "../content/dialogue/dialogueTrees";
import { STRAINS, STRAIN_PRICES } from "../content/items/strains";
import { STARTING_WEAPONS, WEAPON_STORE } from "../content/items/weapons";
import type { UiStartState } from "../services/save/SaveSystem";
import { maxHealthForEndurance, statForLevel } from "../babylon/progression/Progression";

// ---------- Initial state ----------

const initialPlayer: PlayerState = {
  name: "Clipper Zaza",
  // Same starting value as the real-time health system — its own first
  // playerHealthChanged fires before React subscribes to the bridge, so
  // this has to already agree with it rather than wait for a sync.
  hp: maxHealthForEndurance(statForLevel(1)),
  maxHp: maxHealthForEndurance(statForLevel(1)),
  gold: 15,
  inventory: [
    { strainId: "indica", quantity: 2 },
    { strainId: "sativa", quantity: 3 },
    { strainId: "ogKush", quantity: 1 },
    { strainId: "kush", quantity: 1 },
    { strainId: "haze", quantity: 2 },
  ],
  reputation: { cordozar: 20, "mary-jane": 10, opps: -10 },
  position: { x: 0, z: 0 },
};

export interface GameState {
  mode: GameMode;
  player: PlayerState;
  activeDialogue: { tree: DialogueTree; nodeId: string } | null;
  questFlags: string[];
  message: string | null; // transient toast, e.g. "You found 5 gold"
  equippedWeapon: WeaponKind | null;
  /** Weapons the player has — only these can be equipped. */
  ownedWeapons: WeaponKind[];
}

const initialState: GameState = {
  mode: "explore",
  player: initialPlayer,
  activeDialogue: null,
  questFlags: [],
  message: null,
  equippedWeapon: null,
  ownedWeapons: STARTING_WEAPONS,
};

// ---------- Actions ----------

type Action =
  | { type: "TALK_TO_NPC"; npcId: string; treeId: string }
  | { type: "CHOOSE_DIALOGUE"; choiceId: string }
  | { type: "OPEN_INVENTORY" }
  | { type: "CLOSE_INVENTORY" }
  | { type: "USE_STRAIN"; strainId: string }
  | { type: "CLEAR_MESSAGE" }
  | { type: "SET_POSITION"; position: WorldPosition }
  | { type: "SHOW_MESSAGE"; text: string }
  | { type: "OPEN_WEAPON_WHEEL" }
  | { type: "CLOSE_WEAPON_WHEEL" }
  | { type: "EQUIP_WEAPON"; weapon: WeaponKind | null }
  | { type: "SYNC_PLAYER_HEALTH"; current: number; max: number }
  | { type: "ADD_GOLD"; amount: number }
  | { type: "BUY_STRAIN"; strainId: string }
  | { type: "BUY_WEAPON"; weapon: WeaponKind }
  | { type: "MOVE_INVENTORY_ITEM"; from: number; to: number };

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "TALK_TO_NPC": {
      if (state.mode !== "explore") return state;
      const tree = DIALOGUE_TREES[action.treeId];
      if (!tree || tree.npcId !== action.npcId) return state;
      return {
        ...state,
        mode: "dialogue",
        activeDialogue: { tree, nodeId: tree.startNodeId },
      };
    }

    case "CHOOSE_DIALOGUE": {
      if (!state.activeDialogue) return state;
      const node = state.activeDialogue.tree.nodes[state.activeDialogue.nodeId];
      const choice = node.choices.find((c) => c.id === action.choiceId);
      if (!choice) return state;

      let player = state.player;
      if (choice.reputationDelta) {
        const { target, amount } = choice.reputationDelta;
        player = {
          ...player,
          reputation: {
            ...player.reputation,
            [target]: (player.reputation[target] ?? 0) + amount,
          },
        };
      }
      const questFlags = choice.questFlag
        ? Array.from(new Set([...state.questFlags, choice.questFlag]))
        : state.questFlags;

      if (!choice.nextNodeId) {
        return { ...state, mode: "explore", activeDialogue: null, player, questFlags };
      }
      return {
        ...state,
        player,
        questFlags,
        activeDialogue: { ...state.activeDialogue, nodeId: choice.nextNodeId },
      };
    }

    case "OPEN_INVENTORY":
      if (state.mode !== "explore") return state;
      return { ...state, mode: "inventory" };

    case "CLOSE_INVENTORY":
      if (state.mode !== "inventory") return state;
      return { ...state, mode: "explore" };

    case "OPEN_WEAPON_WHEEL":
      if (state.mode !== "explore") return state;
      return { ...state, mode: "weaponWheel" };

    case "CLOSE_WEAPON_WHEEL":
      if (state.mode !== "weaponWheel") return state;
      return { ...state, mode: "explore" };

    case "EQUIP_WEAPON":
      return { ...state, equippedWeapon: action.weapon, mode: "explore" };

    case "SYNC_PLAYER_HEALTH":
      // A one-way mirror from the real-time combat system's own health
      // tracking (PlayerController) into this reducer's player.hp/maxHp
      // — the same field HUD has always displayed, now actually kept
      // current instead of frozen at its initial value. Fired on every
      // playerHealthChanged bridge event (damage taken, and healing —
      // see USE_STRAIN below, which updates the real-time side and
      // lets its own resulting event flow back here rather than this
      // reducer guessing the new total itself).
      return { ...state, player: { ...state.player, hp: action.current, maxHp: action.max } };

    case "ADD_GOLD":
      return { ...state, player: { ...state.player, gold: state.player.gold + action.amount } };

    case "USE_STRAIN": {
      const entry = state.player.inventory.find((i: InventoryEntry) => i.strainId === action.strainId);
      const strain = STRAINS[action.strainId];
      if (!entry || entry.quantity <= 0 || !strain) return state;

      // The effect itself (healing, stat buffs) happens in the real-time
      // game — see App's handleUseHealingLeaf. Here the item is used up.
      const player = {
        ...state.player,
        inventory: state.player.inventory
          .map((i) => (i.strainId === action.strainId ? { ...i, quantity: i.quantity - 1 } : i))
          .filter((i) => i.quantity > 0),
      };
      return { ...state, player, message: `Used ${strain.name}.` };
    }

    case "BUY_STRAIN": {
      const strain = STRAINS[action.strainId];
      const price = STRAIN_PRICES[action.strainId];
      if (!strain || price === undefined || state.player.gold < price) return state;
      const existing = state.player.inventory.find((i) => i.strainId === action.strainId);
      const inventory = existing
        ? state.player.inventory.map((i) =>
            i.strainId === action.strainId ? { ...i, quantity: i.quantity + 1 } : i
          )
        : [...state.player.inventory, { strainId: action.strainId, quantity: 1 }];
      return {
        ...state,
        player: { ...state.player, gold: state.player.gold - price, inventory },
        message: `Bought ${strain.name} for ${price} gold.`,
      };
    }

    case "BUY_WEAPON": {
      const item = WEAPON_STORE.find((w) => w.kind === action.weapon);
      if (!item || state.ownedWeapons.includes(item.kind) || state.player.gold < item.price) return state;
      return {
        ...state,
        ownedWeapons: [...state.ownedWeapons, item.kind],
        player: { ...state.player, gold: state.player.gold - item.price },
        message: `Bought the ${item.name} for ${item.price} gold. Press 3 to equip it.`,
      };
    }

    case "MOVE_INVENTORY_ITEM": {
      // Drag-and-drop in the Satchel. Dropping onto another item swaps
      // the two; dropping onto an empty slot moves the item there — the
      // inventory is a packed list, so that means to the end of it. This
      // also determines the side dock's first-3 slots (see HUD.tsx),
      // which are read directly off the front of this same array.
      const { from, to } = action;
      const inventory = [...state.player.inventory];
      if (from < 0 || from >= inventory.length || from === to || to < 0) return state;
      if (to < inventory.length) {
        [inventory[from], inventory[to]] = [inventory[to], inventory[from]];
      } else {
        const [moved] = inventory.splice(from, 1);
        inventory.push(moved);
      }
      return { ...state, player: { ...state.player, inventory } };
    }

    case "CLEAR_MESSAGE":
      return { ...state, message: null };

    case "SET_POSITION":
      return { ...state, player: { ...state.player, position: action.position } };

    case "SHOW_MESSAGE":
      return { ...state, message: action.text };

    default:
      return state;
  }
}

/** The starting state — a new game's, or a loaded save's (see services/save/SaveSystem). */
function startState(from?: UiStartState | null): GameState {
  if (!from) return initialState;
  return {
    ...initialState,
    equippedWeapon: from.equippedWeapon,
    ownedWeapons: from.ownedWeapons,
    questFlags: from.questFlags,
    player: {
      ...initialState.player,
      gold: from.gold,
      inventory: from.inventory,
      reputation: from.reputation,
    },
  };
}

export function useGameState(from?: UiStartState | null) {
  const [state, dispatch] = useReducer(reducer, from, startState);

  /** Opens `treeId` (see dialogueTreeFor) with `npcId`. */
  const talkToNpc = useCallback((npcId: string, treeId: string) => dispatch({ type: "TALK_TO_NPC", npcId, treeId }), []);
  const chooseDialogue = useCallback(
    (choiceId: string) => dispatch({ type: "CHOOSE_DIALOGUE", choiceId }),
    []
  );
  const openInventory = useCallback(() => dispatch({ type: "OPEN_INVENTORY" }), []);
  const closeInventory = useCallback(() => dispatch({ type: "CLOSE_INVENTORY" }), []);
  const openWeaponWheel = useCallback(() => dispatch({ type: "OPEN_WEAPON_WHEEL" }), []);
  const closeWeaponWheel = useCallback(() => dispatch({ type: "CLOSE_WEAPON_WHEEL" }), []);
  const equipWeapon = useCallback(
    (weapon: WeaponKind | null) => dispatch({ type: "EQUIP_WEAPON", weapon }),
    []
  );
  // Not named useStrain — a "use" prefix makes React's hooks lint rules
  // and the React Compiler treat this plain callback as a hook.
  const consumeStrain = useCallback(
    (strainId: string) => dispatch({ type: "USE_STRAIN", strainId }),
    []
  );
  const clearMessage = useCallback(() => dispatch({ type: "CLEAR_MESSAGE" }), []);
  const setPosition = useCallback(
    (position: WorldPosition) => dispatch({ type: "SET_POSITION", position }),
    []
  );
  const showMessage = useCallback((text: string) => dispatch({ type: "SHOW_MESSAGE", text }), []);
  const syncPlayerHealth = useCallback(
    (current: number, max: number) => dispatch({ type: "SYNC_PLAYER_HEALTH", current, max }),
    []
  );
  const addGold = useCallback((amount: number) => dispatch({ type: "ADD_GOLD", amount }), []);
  const buyStrain = useCallback((strainId: string) => dispatch({ type: "BUY_STRAIN", strainId }), []);
  const buyWeapon = useCallback((weapon: WeaponKind) => dispatch({ type: "BUY_WEAPON", weapon }), []);
  const moveInventoryItem = useCallback(
    (from: number, to: number) => dispatch({ type: "MOVE_INVENTORY_ITEM", from, to }),
    []
  );

  return useMemo(
    () => ({
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
    }),
    [
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
    ]
  );
}
