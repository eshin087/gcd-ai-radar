"use client";

import { useEffect, useRef, useState } from "react";
import { CHANGE_MS, DISSOLVE_MS, dissolveFrame, motionOn } from "@/components/fx/ascii";
import { useBuild } from "@/components/home/panel/useBuild";

/**
 * A number on the panel. The server renders it final. Under motion it waits
 * hidden (data-num="wait", globals.css) until its instrument builds, then
 * dissolves into place through % + : · in 520 ms; when its value changes
 * later (the live layer, a new stack) it dissolves into the new value in
 * 700 ms. Without motion it just shows the value.
 */
export function Num({ value, className, title }: { value: string; className?: string; title?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<"wait" | "run" | "done">("wait");
  const [shown, setShown] = useState(value);
  const raf = useRef(0);
  const target = useRef(value);

  /** Dissolves into `text` over `ms`; every state change happens in an animation frame. */
  const run = (text: string, ms: number) => {
    cancelAnimationFrame(raf.current);
    let t0 = 0;
    const step = (t: number) => {
      t0 ||= t;
      const k = ms > 0 ? (t - t0) / ms : 1;
      if (k >= 1) {
        setShown(text);
        setPhase("done");
        return;
      }
      setPhase("run");
      setShown(dissolveFrame(text, k));
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  useBuild(ref, (instant) => {
    if (instant) {
      setShown(target.current);
      setPhase("done");
    } else run(target.current, DISSOLVE_MS);
  });

  useEffect(() => {
    if (value === target.current) return;
    target.current = value;
    if (phase !== "wait") run(value, motionOn() ? CHANGE_MS : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on a new value only
  }, [value]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <span ref={ref} data-num={phase} className={className} title={title}>
      {phase === "wait" ? value : shown}
    </span>
  );
}
