"use client";

import { useEffect, useRef, type RefObject } from "react";
import { BUILD_EVENT, motionOn, type BuildDetail } from "@/components/fx/ascii";

/**
 * Calls `onBuild` once, when the instrument holding `ref` builds
 * (PanelMotion fires BUILD_EVENT on its `[data-build]` section). `instant`
 * is true when there is no motion or the instrument had built before this
 * component mounted. The callback may change between renders; the latest one
 * runs.
 */
export function useBuild(ref: RefObject<Element | null>, onBuild: (instant: boolean) => void) {
  const cb = useRef(onBuild);
  useEffect(() => {
    cb.current = onBuild;
  });
  useEffect(() => {
    const sec = ref.current?.closest<HTMLElement>("[data-build]");
    if (!sec || !motionOn() || sec.dataset.built) {
      cb.current(true);
      return;
    }
    const on = (e: Event) => cb.current((e as CustomEvent<BuildDetail>).detail?.instant ?? true);
    sec.addEventListener(BUILD_EVENT, on, { once: true });
    return () => sec.removeEventListener(BUILD_EVENT, on);
  }, [ref]);
}
