// src/screens/menu/AccountPanel.tsx
// Account: who's signed in, log out, download your data, delete your
// account (App Store guideline 5.1.1(v): an app that lets you create an
// account must let you delete it from inside the app).

import { useState, type FormEvent } from "react";
import { BackendError, type GameBackend, type PublicUser } from "../../services/backend";

interface AccountPanelProps {
  backend: GameBackend;
  user: PublicUser;
  onLogOut: () => void;
  onAccountDeleted: () => void;
}

export function AccountPanel({ backend, user, onLogOut, onAccountDeleted }: AccountPanelProps) {
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setError(null);
    try {
      const data = await backend.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `legend-of-zaza-${data.user.username}-data.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (err) {
      setError(err instanceof BackendError ? err.message : "Couldn't get your data. Please try again.");
    }
  };

  const remove = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await backend.deleteAccount(password);
      onAccountDeleted();
    } catch (err) {
      setError(err instanceof BackendError ? err.message : "Couldn't delete the account. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const row = "border border-stone-700 px-3 py-2.5 text-left text-sm font-bold tracking-widest text-stone-200 uppercase transition-colors hover:border-amber-500 hover:bg-stone-800";

  return (
    <div className="flex flex-col gap-2">
      <p className="mb-1 text-sm text-stone-400">
        Signed in as <span className="font-semibold text-stone-100">{user.username}</span>
        <span className="block text-xs text-stone-500">Member since {new Date(user.createdAt).toLocaleDateString()}</span>
      </p>
      <button onClick={onLogOut} className={row}>
        Log out
      </button>
      <button onClick={download} className={row}>
        Download my data
      </button>
      {deleting ? (
        <form onSubmit={remove} className="flex flex-col gap-2 border border-rose-900/60 bg-rose-950/40 p-3">
          <p className="text-sm text-rose-200">This permanently deletes your account, your saved game and all its data. It can't be undone.</p>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password to confirm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-stone-700 bg-stone-900 px-3 py-2 text-sm outline-none focus:border-rose-600"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !password} className="flex-1 bg-rose-700 px-3 py-2 text-sm font-bold uppercase hover:bg-rose-600 disabled:opacity-50">
              {busy ? "Deleting…" : "Delete account"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleting(false);
                setPassword("");
                setError(null);
              }}
              className="flex-1 border border-stone-700 px-3 py-2 text-sm font-bold uppercase hover:bg-stone-800"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setDeleting(true)} className={`${row} border-rose-900/70 text-rose-300 hover:border-rose-500`}>
          Delete account
        </button>
      )}
      {error && <p className="text-sm text-rose-400">{error}</p>}
    </div>
  );
}
