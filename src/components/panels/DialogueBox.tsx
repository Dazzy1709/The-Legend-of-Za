// src/components/panels/DialogueBox.tsx
import type { DialogueTree } from "../../types.ts";

interface DialogueBoxProps {
  tree: DialogueTree;
  nodeId: string;
  onChoose: (choiceId: string) => void;
}

export function DialogueBox({ tree, nodeId, onChoose }: DialogueBoxProps) {
  const node = tree.nodes[nodeId];
  if (!node) return null;

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 flex items-end sm:items-center justify-center bg-black/50 p-3 sm:p-6 z-20 rounded-4xl">
      <div className="w-full max-w-md bg-stone-900 border border-amber-900/50 rounded-t-xl sm:rounded-xl shadow-2xl overflow-hidden">
        <div className="px-4 py-3 bg-stone-950 border-b border-amber-900/40">
          <span className="font-serif text-amber-300 text-sm">{node.speaker}</span>
        </div>
        <div className="px-4 py-4">
          <p className="text-stone-200 text-sm leading-relaxed">{node.text}</p>
        </div>
        <div className="flex flex-col gap-2 px-4 pb-4">
          {node.choices.map((choice) => (
            <button
              key={choice.id}
              onClick={() => onChoose(choice.id)}
              className="text-left rounded-md bg-stone-800 hover:bg-stone-700 border border-stone-700 px-3 py-2 text-sm text-stone-100 transition-colors"
            >
              {choice.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
