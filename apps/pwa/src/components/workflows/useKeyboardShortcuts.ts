// Ergonomic-port Tier E3.2 (2026-05-11) — keyboard shortcut router.
//
// Avoids `react-hotkeys-hook` (~5 KB) — n binding count is small and
// our matcher is straightforward. Keys are checked against `event.key`
// (the printable / named key) and modifiers (`metaKey`, `ctrlKey`,
// `altKey`, `shiftKey`).
//
// All bindings auto-skip when the focused element is an input /
// textarea / contentEditable so the YAML editor stays typeable. The
// caller can also pass `enabled: false` to disable everything (e.g.
// when the graph editor isn't visible).

'use client';

import { useEffect } from 'react';

export interface ShortcutBinding {
  /** `event.key` exact match, e.g. 'd', 'F2', 'Enter', '\\'. Case
   *  matters for letter keys — pass lowercase + we'll normalize. */
  key: string;
  /** Required modifier set. Omit a field to allow either state. */
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  /** Treat metaKey OR ctrlKey as the same modifier (cross-platform
   *  Cmd/Ctrl chord). Use this for binding "save", "duplicate", etc. */
  metaOrCtrl?: boolean;
  handler: (e: KeyboardEvent) => void;
  /** Default true — call preventDefault when matched. Bindings that
   *  shadow native browser behavior (e.g. Cmd+D bookmark) want this
   *  on so the browser doesn't also fire. */
  preventDefault?: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target as HTMLElement).tagName) return false;
  const t = target as HTMLElement;
  const tag = t.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || t.isContentEditable;
}

/** Pure: returns true if the binding matches the given event. Pulled
 *  out so unit tests can hammer the matcher without a DOM. */
export function matchesBinding(b: ShortcutBinding, e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  if (b.key.toLowerCase() !== e.key.toLowerCase()) return false;
  if (b.metaOrCtrl) {
    if (!(e.metaKey || e.ctrlKey)) return false;
  } else {
    if (b.meta !== undefined && b.meta !== e.metaKey) return false;
    if (b.ctrl !== undefined && b.ctrl !== e.ctrlKey) return false;
  }
  if (b.alt !== undefined && b.alt !== e.altKey) return false;
  if (b.shift !== undefined && b.shift !== e.shiftKey) return false;
  return true;
}

export function useKeyboardShortcuts(bindings: ShortcutBinding[], opts?: { enabled?: boolean }): void {
  const enabled = opts?.enabled ?? true;
  useEffect(() => {
    if (!enabled || bindings.length === 0) return;
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)) return;
      for (const b of bindings) {
        if (matchesBinding(b, e)) {
          if (b.preventDefault !== false) e.preventDefault();
          b.handler(e);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, bindings]);
}
