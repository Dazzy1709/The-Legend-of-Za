// src/components/hud/InteractionPrompt.tsx

interface InteractionPromptProps {
  label: string | null;
  /** "talk to" for people, "rest at" for the safe house, ... */
  action?: string;
  onTap: () => void;
}

export function InteractionPrompt({ label, action = "talk to", onTap }: InteractionPromptProps) {
  if (!label) return null;
  return (
    <button
      onClick={onTap}
      className="fixed bottom-24 sm:bottom-8 compact:bottom-4! left-1/2 -translate-x-1/2 bg-stone-900/90 border border-amber-700/60 text-amber-200 text-sm px-4 py-2 rounded-full shadow-lg backdrop-blur-sm z-20 active:scale-95 transition-transform"
    >
      <span className="hidden sm:inline">
        Press <kbd className="px-1.5 py-0.5 bg-stone-800 rounded text-amber-300 mx-1">E</kbd>
        to {action} {label}
      </span>
      <span className="sm:hidden capitalize">
        {action} {label}
      </span>
    </button>
  );
}
