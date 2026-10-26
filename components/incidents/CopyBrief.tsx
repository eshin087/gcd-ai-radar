"use client";

import { useState } from "react";

/**
 * Copies the record's Markdown brief (lib/brief.ts) for a coding agent or a
 * ticket. The same text sits in the closed details below the button, so it
 * can be read and selected without JavaScript.
 */
export function CopyBrief({ brief }: { brief: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(brief);
            setState("done");
          } catch {
            setState("failed");
          }
          window.setTimeout(() => setState("idle"), 2000);
        }}
        className="rounded-[2px] border border-accent/50 bg-accent-tint px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.08em] text-accent hover:border-accent"
      >
        {state === "done" ? "copied" : state === "failed" ? "copy failed, select below" : "Copy brief for your AI"}
      </button>
      <details className="group">
        <summary className="label cursor-pointer select-none hover:text-ink">the brief as text</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-[2px] border border-line bg-panel p-3 font-mono text-[12px] leading-relaxed text-soft">{brief}</pre>
      </details>
    </div>
  );
}
