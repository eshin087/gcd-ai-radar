"use client";

import { useState, type ReactNode } from "react";

interface Props {
  /** Rendered when the "all incidents" view is active. */
  all: ReactNode;
  /** Rendered when the "real-world only" view is active. */
  real: ReactNode;
  defaultView?: "all" | "real";
  labels?: [string, string];
  /** Where the toggle sits relative to the content. */
  togglePosition?: "above-right" | "top-right" | "top-left" | "inline";
  size?: "sm" | "md";
  className?: string;
}

/**
 * Toggles between two server-rendered views (all incidents vs. severity 3-4
 * only). Both trees are prerendered, so the switch is instant and works in a
 * static export.
 */
export function DualView({
  all,
  real,
  defaultView = "all",
  labels = ["All incidents", "Real-world only"],
  togglePosition = "above-right",
  size = "md",
  className = "",
}: Props) {
  const [view, setView] = useState<"all" | "real">(defaultView);
  const toggle = (
    <div
      role="tablist"
      aria-label="Incident view"
      className={`inline-flex rounded-[3px] border border-line p-0.5 font-mono uppercase tracking-[0.1em] ${size === "sm" ? "text-[10px]" : "text-[10.5px]"}`}
    >
      {(["all", "real"] as const).map((v, i) => (
        <button
          key={v}
          role="tab"
          aria-selected={view === v}
          onClick={() => setView(v)}
          className={`px-2 py-1 rounded-[2px] transition-colors ${view === v ? "bg-accent-tint text-accent" : "text-dim hover:text-ink"}`}
        >
          {labels[i]}
        </button>
      ))}
    </div>
  );
  if (togglePosition === "inline" || togglePosition === "above-right") {
    return (
      <div className={className}>
        <div className={togglePosition === "above-right" ? "flex justify-end" : ""}>{toggle}</div>
        <div className="mt-2">{view === "all" ? all : real}</div>
      </div>
    );
  }
  return (
    <div className={`relative ${className}`}>
      <div className={`absolute top-0 z-10 ${togglePosition === "top-right" ? "right-0" : "left-0"}`}>{toggle}</div>
      {view === "all" ? all : real}
    </div>
  );
}
