// src/screens/menu/MenuList.tsx
// The Black Ops 2-style option list: big uppercase entries, the selected
// one on a bright bar. Mouse hover selects, click confirms; arrow keys /
// W-S move, Enter / Space confirm. Disabled entries ("coming soon") can be
// highlighted to read their description but not chosen.

import { useEffect } from "react";

export interface MenuItem {
  id: string;
  label: string;
  /** Shown in the details panel while the entry is highlighted. */
  description: string;
  /** e.g. "COMING SOON". */
  tag?: string;
  disabled?: boolean;
}

interface MenuListProps {
  items: MenuItem[];
  selected: number;
  onSelect: (index: number) => void;
  onConfirm: (item: MenuItem) => void;
  /** Keyboard input is ignored while false (e.g. a text field has focus elsewhere). */
  keyboard: boolean;
}

export function MenuList({ items, selected, onSelect, onConfirm, keyboard }: MenuListProps) {
  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "arrowdown" || key === "s") {
        e.preventDefault();
        onSelect((selected + 1) % items.length);
      } else if (key === "arrowup" || key === "w") {
        e.preventDefault();
        onSelect((selected - 1 + items.length) % items.length);
      } else if (key === "enter" || key === " ") {
        e.preventDefault();
        const item = items[selected];
        if (item && !item.disabled) onConfirm(item);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboard, items, selected, onSelect, onConfirm]);

  return (
    <nav className="flex flex-col gap-1" aria-label="Main menu">
      {items.map((item, i) => {
        const active = i === selected;
        return (
          <button
            key={item.id}
            onMouseEnter={() => onSelect(i)}
            onFocus={() => onSelect(i)}
            onClick={() => !item.disabled && onConfirm(item)}
            aria-disabled={item.disabled}
            className={`group relative flex items-center gap-3 py-1.5 pl-5 pr-10 text-left text-2xl font-black tracking-[0.12em] uppercase transition-all duration-150 sm:text-3xl ${
              active
                ? item.disabled
                  ? "bg-stone-700/80 text-stone-300 [clip-path:polygon(0_0,100%_0,94%_100%,0_100%)]"
                  : "bg-amber-500 text-stone-950 [clip-path:polygon(0_0,100%_0,94%_100%,0_100%)]"
                : item.disabled
                  ? "text-stone-600"
                  : "text-stone-300 hover:text-white"
            }`}
          >
            <span className={`absolute left-0 top-0 h-full w-1.5 ${active ? (item.disabled ? "bg-stone-400" : "bg-white") : "bg-transparent"}`} />
            {item.label}
            {item.tag && (
              <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold tracking-[0.2em] ${active ? "bg-stone-950/80 text-amber-400" : "bg-stone-800 text-stone-400"}`}>
                {item.tag}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
