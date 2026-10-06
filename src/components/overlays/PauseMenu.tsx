// src/components/overlays/PauseMenu.tsx
// The in-game menu (Esc or the ☰ button), in the same style as the main
// menu: Resume, Save Game, Settings, Main Menu. Settings opens in place;
// Main Menu saves first, then leaves.

import { useCallback, useEffect, useMemo, useState } from "react";
import { MenuList, type MenuItem } from "../../screens/menu/MenuList";
import type { GameSettings } from "../../services/settings/settings";
import type { SaveState } from "../hud/SaveIndicator";

interface PauseMenuProps {
  username: string;
  saveState: SaveState;
  settings: GameSettings;
  onChangeSettings: (settings: GameSettings) => void;
  onResume: () => void;
  onSave: () => void;
  onQuitToMenu: () => void;
}

export function PauseMenu({ username, saveState, settings, onChangeSettings, onResume, onSave, onQuitToMenu }: PauseMenuProps) {
  const [screen, setScreen] = useState<"main" | "settings" | "confirmQuit">("main");
  const [selected, setSelected] = useState(0);

  const items = useMemo<MenuItem[]>(
    () => [
      { id: "resume", label: "Resume", description: "Back to the game." },
      {
        id: "save",
        label: saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : "Save Game",
        description: "Save your progress to your account now. The game also saves on its own.",
      },
      { id: "settings", label: "Settings", description: "Controls and sound." },
      {
        id: "mainmenu",
        label: "Main Menu",
        description: "Save and go back to the main menu.",
      },
    ],
    [saveState],
  );

  const choose = useCallback(
    (item: MenuItem) => {
      if (item.id === "resume") onResume();
      else if (item.id === "save") onSave();
      else if (item.id === "settings") setScreen("settings");
      else if (item.id === "mainmenu") setScreen("confirmQuit");
    },
    [onResume, onSave],
  );

  // Esc: back out of a page, or close the menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (screen === "main") onResume();
      else setScreen("main");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [screen, onResume]);

  const set = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => onChangeSettings({ ...settings, [key]: value });

  return (
    <div className="fixed inset-0 z-40 flex bg-black/70 backdrop-blur-[3px]">
      {/* Scrolls when it doesn't fit (a sideways phone); the inner my-auto keeps it centred when it does. */}
      <div className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-linear-to-r from-stone-950/95 to-transparent pr-8 pl-[max(2rem,env(safe-area-inset-left))] sm:pr-14 sm:pl-[max(3.5rem,env(safe-area-inset-left))]">
        <div className="my-auto py-6 short:py-3">
          <p className="text-xs font-bold tracking-[0.5em] text-amber-500 uppercase">Paused</p>
          <p className="mb-6 text-xs text-stone-500 short:mb-3">Playing as {username}</p>

          {screen === "main" && <MenuList items={items} selected={selected} onSelect={setSelected} onConfirm={choose} keyboard />}

          {screen === "settings" && (
            <div className="flex flex-col gap-5 [animation:levelup-in_220ms_ease-out]">
              <h2 className="border-l-4 border-amber-500 pl-3 text-2xl font-black tracking-[0.12em] uppercase">Settings</h2>
              <Slider label="Look sensitivity" value={settings.lookSensitivity} min={0.25} max={2} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set("lookSensitivity", v)} />
              <Toggle label="Invert look up/down" value={settings.invertLookY} onChange={(v) => set("invertLookY", v)} />
              <Slider label="Master volume" value={settings.masterVolume} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set("masterVolume", v)} />
              <button onClick={() => setScreen("main")} className="self-start text-xs font-bold tracking-[0.2em] text-stone-400 uppercase hover:text-amber-400">
                ‹ Back
              </button>
            </div>
          )}

          {screen === "confirmQuit" && (
            <div className="flex flex-col gap-3 [animation:levelup-in_220ms_ease-out]">
              <h2 className="border-l-4 border-amber-500 pl-3 text-2xl font-black tracking-[0.12em] uppercase">Main Menu</h2>
              <p className="text-sm text-stone-300">Your progress will be saved to your account first.</p>
              <div className="flex gap-2">
                <button onClick={onQuitToMenu} className="flex-1 bg-amber-500 px-3 py-2.5 text-sm font-black tracking-widest text-stone-950 uppercase hover:bg-amber-400">
                  Save & quit
                </button>
                <button onClick={() => setScreen("main")} className="flex-1 border border-stone-700 px-3 py-2.5 text-sm font-bold tracking-widest uppercase hover:bg-stone-800">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex justify-between text-xs font-bold tracking-[0.2em] text-stone-300 uppercase">
        {label}
        <span className="tabular-nums text-amber-400">{format(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-amber-500" />
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="flex items-center justify-between text-xs font-bold tracking-[0.2em] text-stone-300 uppercase" aria-pressed={value}>
      {label}
      <span className={`w-14 py-1 text-center ${value ? "bg-amber-500 text-stone-950" : "bg-stone-800 text-stone-400"}`}>{value ? "On" : "Off"}</span>
    </button>
  );
}
