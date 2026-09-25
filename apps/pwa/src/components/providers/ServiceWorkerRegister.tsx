'use client';

// PWA service worker registration mount — Phase 1 (foundation).
//
// One-shot client component dropped into the root layout so the SW
// is registered on the very first PWA paint regardless of which
// route the user lands on (/term · /chat · /workspace · etc.).
//
// Why a component (not a hook called from layout): the layout is a
// server component by Next.js convention. Calling navigator from a
// server component would crash; encapsulating the effect in a
// 'use client' component keeps the layout simple and makes the
// no-op-on-SSR contract explicit.
//
// The registration is silent at Phase 1 — no toast, no UI. Future
// phases (4: update-available prompt) will mount a sibling Toast
// driven by the same registration outcome.

import { useEffect, useRef } from 'react';
import { registerServiceWorker } from '@/lib/register-sw';

export function ServiceWorkerRegister() {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void registerServiceWorker();
  }, []);

  return null;
}
