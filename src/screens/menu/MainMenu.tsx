// src/screens/menu/MainMenu.tsx
// The main menu, Black Ops 2-style: a column of big selectable options on
// the left, details for the highlighted one on the right. Choosing an
// option either does it (Single Player starts the game) or opens a panel
// in its place (sign in, account, privacy) with Esc / Back to return.
//
// Single Player needs an account, so progress is saved to it: signed out,
// it opens the sign-in panel first and starts the game straight after.
// To add a menu entry: add it to `items` and handle its id in `choose`.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { GameBackend, PublicUser } from "../../services/backend";
import { summarizeSave, type SaveGame } from "../../../shared/save";
import { STORY } from "../../content/story/missions";
import { MenuList, type MenuItem } from "./MenuList";
import { AuthPanel } from "./AuthPanel";
import { AccountPanel } from "./AccountPanel";
import { PrivacyPolicy } from "./PrivacyPolicy";
import { formatPlayTime, timeAgo } from "./format";

type Screen = "main" | "signIn" | "account" | "privacy" | "newGame";

interface MainMenuProps {
  backend: GameBackend;
  user: PublicUser | null;
  save: SaveGame | null;
  /** Shown at the top (a problem loading the save, an account just deleted...). */
  notice?: string | null;
  /** Signed in; `andPlay` = they came from Single Player, so start the game next. */
  onAuthenticated: (user: PublicUser, andPlay: boolean) => void;
  /** Start playing: continue `save`, or a new game when null. */
  onPlay: (save: SaveGame | null) => void;
  onLogOut: () => void;
  onAccountDeleted: () => void;
}

export function MainMenu({ backend, user, save, notice, onAuthenticated, onPlay, onLogOut, onAccountDeleted }: MainMenuProps) {
  const [screen, setScreen] = useState<Screen>("main");
  const [selected, setSelected] = useState(0);
  /** The sign-in panel was opened by Single Player — play once signed in. */
  const [playAfterSignIn, setPlayAfterSignIn] = useState(false);

  const summary = save ? summarizeSave(save) : null;
  const missionTitle = summary?.activeMissionId ? STORY.find((m) => m.id === summary.activeMissionId)?.title : null;

  const items = useMemo<MenuItem[]>(() => {
    const list: MenuItem[] = [
      {
        id: "singleplayer",
        label: "Single Player",
        description: !user
          ? "Play the story of Zaza. You'll sign in first so your progress is saved to your account."
          : summary
            ? `Continue your story — Level ${summary.level}${missionTitle ? ` · ${missionTitle}` : ""}. Saved ${timeAgo(summary.savedAt)}, ${formatPlayTime(summary.playTimeSeconds)} played.`
            : "Begin the story of Zaza in Kushtar, capital of the green realm.",
      },
      { id: "multiplayer", label: "Multiplayer", tag: "Coming soon", disabled: true, description: "Fly, fight and trade with friends. Coming in a future update." },
    ];
    if (user && summary) list.push({ id: "newgame", label: "New Game", description: "Start the story over from the beginning. Your current progress will be replaced." });
    list.push({ id: "account", label: user ? "Account" : "Sign In", description: user ? `Signed in as ${user.username}. Log out, download your data or delete your account.` : "Sign in or create an account." });
    list.push({ id: "privacy", label: "Privacy", description: "What the game stores about you, and your choices." });
    return list;
  }, [user, summary, missionTitle]);

  // Keep the highlight valid as entries come and go (signing in adds New Game).
  const current = Math.min(selected, items.length - 1);

  const choose = useCallback(
    (item: MenuItem) => {
      switch (item.id) {
        case "singleplayer":
          if (user) onPlay(save);
          else {
            setPlayAfterSignIn(true);
            setScreen("signIn");
          }
          break;
        case "newgame":
          setScreen("newGame");
          break;
        case "account":
          setPlayAfterSignIn(false);
          setScreen(user ? "account" : "signIn");
          break;
        case "privacy":
          setScreen("privacy");
          break;
      }
    },
    [user, save, onPlay]
  );

  const back = useCallback(() => {
    setScreen("main");
    setPlayAfterSignIn(false);
  }, []);

  // Esc goes back from any panel.
  useEffect(() => {
    if (screen === "main") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, back]);

  const handleAuthenticated = (u: PublicUser) => {
    const andPlay = playAfterSignIn;
    setScreen("main");
    setPlayAfterSignIn(false);
    onAuthenticated(u, andPlay);
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-stone-950 text-stone-100 select-none">
      {/* Backdrop: a dark, slowly breathing dusk over hills. */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#0c0a09_0%,#1c1917_40%,#292524_68%,#1a2e05_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_85%,rgba(132,204,22,0.18)_0%,transparent_55%)] [animation:menu-breathe_9s_ease-in-out_infinite]" />
      <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.025)_0px,rgba(255,255,255,0.025)_1px,transparent_1px,transparent_4px)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.75)_100%)]" />

      {/* Padded clear of a phone's notch and home indicator; on a short (sideways phone) screen it tightens up and the middle scrolls. */}
      <div className="relative z-10 flex h-full flex-col px-[max(1.5rem,env(safe-area-inset-left),env(safe-area-inset-right))] pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-[max(3.5rem,env(safe-area-inset-left),env(safe-area-inset-right))] sm:py-10 short:py-3 short:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <header>
          <p className="text-xs font-bold tracking-[0.5em] text-amber-500/90 uppercase">The Legend of</p>
          <h1 className="text-5xl font-black tracking-[0.08em] text-stone-50 uppercase drop-shadow-[0_0_30px_rgba(245,158,11,0.25)] sm:text-6xl short:text-3xl">Zaza</h1>
          {notice && <p className="mt-3 max-w-md border-l-4 border-amber-500 bg-stone-900/80 px-3 py-2 text-sm text-amber-100">{notice}</p>}
        </header>

        <div className="mt-8 flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto sm:mt-14 lg:flex-row lg:items-start lg:gap-16 short:mt-3">
          <div className="w-full max-w-md">
            {screen === "main" ? (
              <MenuList items={items} selected={current} onSelect={setSelected} onConfirm={choose} keyboard={screen === "main"} />
            ) : (
              <Panel title={panelTitle(screen, playAfterSignIn)} onBack={back}>
                {screen === "signIn" && (
                  <>
                    {playAfterSignIn && (
                      <p className="mb-4 border-l-4 border-amber-500 bg-stone-900/80 px-3 py-2 text-sm text-stone-200">
                        You need an account to play, so your progress gets saved to it. Sign in, or create one in a few seconds.
                      </p>
                    )}
                    <AuthPanel backend={backend} onAuthenticated={handleAuthenticated} onShowPrivacy={() => setScreen("privacy")} />
                  </>
                )}
                {screen === "account" && user && (
                  <AccountPanel
                    backend={backend}
                    user={user}
                    onLogOut={() => {
                      onLogOut();
                      back();
                    }}
                    onAccountDeleted={() => {
                      onAccountDeleted();
                      back();
                    }}
                  />
                )}
                {screen === "privacy" && <PrivacyPolicy />}
                {screen === "newGame" && (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-stone-300">Start the story over? Your saved progress (Level {summary?.level ?? 1}) will be replaced as soon as the new game saves.</p>
                    <div className="flex gap-2">
                      <button onClick={() => onPlay(null)} className="flex-1 bg-rose-700 px-3 py-2.5 text-sm font-black tracking-widest uppercase hover:bg-rose-600">
                        Start over
                      </button>
                      <button onClick={back} className="flex-1 border border-stone-700 px-3 py-2.5 text-sm font-bold tracking-widest uppercase hover:bg-stone-800">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </Panel>
            )}
          </div>

          {screen === "main" && (
            <aside key={items[current]?.id} className="hidden max-w-sm border-l-2 border-amber-500/70 bg-stone-950/60 px-5 py-4 [animation:levelup-in_220ms_ease-out] lg:block">
              <p className="text-xs font-bold tracking-[0.3em] text-amber-500 uppercase">{items[current]?.label}</p>
              <p className="mt-2 text-sm leading-relaxed text-stone-300">{items[current]?.description}</p>
            </aside>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-800 pt-3 text-[11px] font-bold tracking-[0.2em] text-stone-500 uppercase short:pt-2">
          <span className="[@media(pointer:coarse)]:hidden">
            <Key>↑↓</Key> Select <Key>Enter</Key> Confirm {screen !== "main" && <><Key>Esc</Key> Back</>}
          </span>
          <span>
            {user ? (
              <>
                Signed in · <span className="text-stone-300">{user.username}</span>
              </>
            ) : (
              "Not signed in"
            )}
            <span className="ml-3 text-stone-600">{backend.kind === "online" ? "Saved to your account" : "Saved on this device"}</span>
          </span>
        </footer>
      </div>
    </div>
  );
}

function panelTitle(screen: Screen, playAfterSignIn: boolean): string {
  switch (screen) {
    case "signIn":
      return playAfterSignIn ? "Sign in to play" : "Sign in";
    case "account":
      return "Account";
    case "privacy":
      return "Privacy Policy";
    case "newGame":
      return "New game";
    default:
      return "";
  }
}

function Panel({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="[animation:levelup-in_220ms_ease-out]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="border-l-4 border-amber-500 pl-3 text-2xl font-black tracking-[0.12em] uppercase">{title}</h2>
        <button onClick={onBack} className="text-xs font-bold tracking-[0.2em] text-stone-400 uppercase hover:text-amber-400">
          ‹ Back
        </button>
      </div>
      <div className="border border-stone-800 bg-stone-950/80 p-4 backdrop-blur">{children}</div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <span className="mx-1 rounded-sm border border-stone-600 px-1.5 py-0.5 text-stone-300">{children}</span>;
}
