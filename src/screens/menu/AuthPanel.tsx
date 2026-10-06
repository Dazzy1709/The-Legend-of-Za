// src/screens/menu/AuthPanel.tsx
// Log in / sign up.

import { useState, type FormEvent } from "react";
import { BackendError, type GameBackend, type PublicUser } from "../../services/backend";

interface AuthPanelProps {
  backend: GameBackend;
  onAuthenticated: (user: PublicUser) => void;
  onShowPrivacy: () => void;
}

export function AuthPanel({ backend, onAuthenticated, onShowPrivacy }: AuthPanelProps) {
  const [mode, setMode] = useState<"logIn" | "signUp">("logIn");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "signUp" && password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const user = mode === "logIn" ? await backend.logIn(username.trim(), password) : await backend.signUp(username.trim(), password);
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof BackendError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-sm border border-stone-700 bg-stone-900/90 px-3 py-2.5 text-sm text-stone-100 outline-none placeholder:text-stone-500 focus:border-amber-500";

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 border border-stone-800 bg-stone-900/80 p-1 text-sm font-bold tracking-widest uppercase">
        {(["logIn", "signUp"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`px-3 py-1.5 transition-colors ${mode === m ? "bg-amber-500 text-stone-950" : "text-stone-400 hover:text-stone-200"}`}
          >
            {m === "logIn" ? "Log in" : "Sign up"}
          </button>
        ))}
      </div>
      <input className={field} placeholder="Username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
      <input
        className={field}
        type="password"
        placeholder="Password"
        autoComplete={mode === "logIn" ? "current-password" : "new-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {mode === "signUp" && (
        <>
          <input className={field} type="password" placeholder="Repeat password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <p className="text-[11px] text-stone-500">
            At least 8 characters. By creating an account you agree to the{" "}
            <button type="button" onClick={onShowPrivacy} className="underline underline-offset-2 hover:text-stone-300">
              Privacy Policy
            </button>
            .
          </p>
        </>
      )}
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || !username || !password}
        className="mt-1 bg-amber-500 px-4 py-2.5 text-sm font-black tracking-[0.2em] text-stone-950 uppercase transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "One moment…" : mode === "logIn" ? "Log in" : "Create account"}
      </button>
    </form>
  );
}
