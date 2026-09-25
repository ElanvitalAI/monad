// WT-X-1 — pointer capability hook.
//
// `@media (pointer: coarse)` evaluates true on touch-first devices
// (iPad, iPhone, most Android). Desktop with mouse → false. Hybrid
// devices (Surface, ChromeOS tablet mode) → true while in tablet
// mode. We use this signal to decide whether to render the mobile
// modifier bar — zero-config UX for the iPad-first dogfood scenario.
//
// SSR safety: matchMedia is undefined during Next.js server render,
// so the hook returns `false` until the first client effect tick.
// This means the bar mounts after hydration on touch devices —
// acceptable trade-off vs SSR-detected user-agent sniffing (fragile,
// privacy-leaky).
//
// Why a hook (vs inline matchMedia in ModifierBar): future consumers
// (TopBar layout shifts, gesture sensitivity tuning, scenario-mode
// auto-open) will want the same signal — centralising avoids drift.

'use client';

import { useEffect, useState } from 'react';

const COARSE_POINTER_QUERY = '(pointer: coarse)';

export function usePointerCapability(): { isCoarsePointer: boolean } {
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(COARSE_POINTER_QUERY);
    setIsCoarsePointer(mql.matches);
    const onChange = (ev: MediaQueryListEvent): void => {
      setIsCoarsePointer(ev.matches);
    };
    // Modern Safari (16+) and Chrome use addEventListener; older
    // Safari (13-) only had addListener. We check feature support
    // so the hook works on iPad 11" 1st-gen too.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    } else if (typeof (mql as MediaQueryList & { addListener?: (l: (e: MediaQueryListEvent) => void) => void }).addListener === 'function') {
      const legacy = mql as MediaQueryList & {
        addListener: (l: (e: MediaQueryListEvent) => void) => void;
        removeListener: (l: (e: MediaQueryListEvent) => void) => void;
      };
      legacy.addListener(onChange);
      return () => legacy.removeListener(onChange);
    }
    return undefined;
  }, []);

  return { isCoarsePointer };
}
