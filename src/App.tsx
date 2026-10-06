// src/App.tsx
// The shell: the main menu, then the game. Owns the backend and the
// signed-in user, loads the account's save before play and writes it
// whenever the game asks.
//
// A page refresh keeps you where you were: the session token keeps you
// signed in, and this tab remembers that it was in the game (only that
// flag — progress itself lives on the account), so it loads the account's
// latest save and drops you straight back in.
//
// Starting a run shows the loading screen first and mounts the game a
// frame later: building the world blocks the page for a moment, so the
// loading screen has to be on screen before it starts.

import { useCallback, useEffect, useState } from "react";
import { createBackend, ServerUnreachableError, type PublicUser } from "./services/backend";
import type { SaveGame } from "../shared/save";
import { MainMenu } from "./screens/menu/MainMenu";
import GameScreen from "./screens/GameScreen";
import { LoadingScreen, type LoadingState } from "./components/overlays/LoadingScreen";
import { RotateDevice } from "./components/overlays/RotateDevice";
import { enterLandscapeFullscreen } from "./services/device";

type Phase = "starting" | "menu" | "playing";

const backend = createBackend();

/** Set while this tab is in the game, so a refresh goes back in (sessionStorage: this tab only, gone when it closes). */
const IN_GAME_KEY = "zaza.inGame";
const RETRY_MS = 3000;

function wasInGame(): boolean {
  try {
    return sessionStorage.getItem(IN_GAME_KEY) === "1";
  } catch {
    return false;
  }
}

function setInGame(inGame: boolean) {
  try {
    if (inGame) sessionStorage.setItem(IN_GAME_KEY, "1");
    else sessionStorage.removeItem(IN_GAME_KEY);
  } catch {
    // Storage blocked: a refresh just lands on the menu.
  }
}

function Shell() {
  const [phase, setPhase] = useState<Phase>("starting");
  const [user, setUser] = useState<PublicUser | null>(null);
  const [save, setSave] = useState<SaveGame | null>(null);
  /** The save the current run started from (null: new game). */
  const [startFrom, setStartFrom] = useState<SaveGame | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Bumped on each new run so the game remounts fresh. */
  const [runId, setRunId] = useState(0);
  /** This run picks up after a refresh (no opening shot). */
  const [resuming, setResuming] = useState(false);
  /** Shown while the server can't be reached at start-up (it keeps retrying). */
  const [connectionProblem, setConnectionProblem] = useState<string | null>(null);
  /** The loading screen (null once it has faded away). */
  const [loading, setLoading] = useState<LoadingState | null>(null);
  /** The run whose game is mounted — lags runId by a frame or two, so the loading screen paints first. */
  const [mountedRun, setMountedRun] = useState(0);

  /** Loads the signed-in account's save (null on failure, with a notice). */
  const loadSave = useCallback(async (): Promise<SaveGame | null> => {
    try {
      const loaded = await backend.loadSave();
      setSave(loaded);
      return loaded;
    } catch {
      setSave(null);
      setNotice("Couldn't load your saved game. Check your connection and try again.");
      return null;
    }
  }, []);

  const play = useCallback((from: SaveGame | null, resume = false) => {
    enterLandscapeFullscreen();
    setStartFrom(from);
    setResuming(resume);
    setRunId((n) => n + 1);
    setLoading({ fraction: 0, secondsLeft: null, done: false });
    setInGame(true);
    setPhase("playing");
  }, []);

  // Mount the game once the loading screen has been painted.
  useEffect(() => {
    if (phase !== "playing" || mountedRun === runId) return;
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setMountedRun(runId));
    });
    return () => cancelAnimationFrame(raf);
  }, [phase, runId, mountedRun]);

  const hideLoading = useCallback(() => setLoading(null), []);

  // A returning player is still signed in — and if this tab was in the
  // game (a refresh), goes straight back in. While the server can't be
  // reached it keeps retrying rather than signing them out.
  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const boot = async () => {
      try {
        const restored = await backend.restoreSession();
        const loaded = restored ? await backend.loadSave() : null;
        if (cancelled) return;
        setConnectionProblem(null);
        setUser(restored);
        setSave(loaded);
        // No save yet (refreshed during the opening): the story starts over.
        if (restored && wasInGame()) play(loaded, loaded !== null);
        else {
          setInGame(false);
          setPhase("menu");
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ServerUnreachableError) {
          setConnectionProblem(err.message);
          retry = setTimeout(() => void boot(), RETRY_MS);
        } else {
          setNotice("Couldn't load your saved game. Please try again.");
          setPhase("menu");
        }
      }
    };
    void boot();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [play]);

  const handleAuthenticated = useCallback(
    async (u: PublicUser, andPlay: boolean) => {
      setUser(u);
      setNotice(null);
      const loaded = await loadSave();
      if (andPlay) play(loaded);
    },
    [loadSave, play]
  );

  const handleLogOut = useCallback(async () => {
    setInGame(false);
    await backend.logOut().catch(() => {});
    setUser(null);
    setSave(null);
  }, []);

  const writeSave = useCallback(async (next: SaveGame, options?: { keepalive?: boolean }) => {
    await backend.writeSave(next, options);
    setSave(next);
  }, []);

  const exitToMenu = useCallback(() => {
    setInGame(false);
    setLoading(null);
    setPhase("menu");
  }, []);

  if (phase === "starting") {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-stone-950 px-6">
        {connectionProblem && <p className="max-w-md border-l-4 border-amber-500 bg-stone-900/80 px-3 py-2 text-sm text-amber-100">{connectionProblem}</p>}
      </div>
    );
  }

  if (phase === "menu" || !user) {
    return (
      <MainMenu
        backend={backend}
        user={user}
        save={save}
        notice={notice}
        onAuthenticated={handleAuthenticated}
        onPlay={play}
        onLogOut={handleLogOut}
        onAccountDeleted={() => {
          setUser(null);
          setSave(null);
          setNotice("Your account and all its data have been deleted.");
        }}
      />
    );
  }

  return (
    <>
      {mountedRun === runId && (
        <GameScreen
          key={runId}
          initialSave={startFrom}
          username={user.username}
          onSave={writeSave}
          onExitToMenu={exitToMenu}
          onLoadingProgress={setLoading}
          resume={resuming}
        />
      )}
      {loading && <LoadingScreen state={loading} onHidden={hideLoading} />}
    </>
  );
}

export default function App() {
  return (
    <>
      <Shell />
      <RotateDevice />
    </>
  );
}
