'use client';

/** FU.B1 (2026-05-09 night) — Focus trap + return-on-close hook for
 *  modal dialogs.
 *
 *  Showroom polish §1 (내부 문서
 *  §4.4): keyboard-only operators couldn't reliably close the save
 *  modal — Tab would escape the dialog and land on the underlying
 *  page's toolbar buttons. This hook:
 *
 *  1. Cycles Tab / Shift+Tab through the focusable elements within
 *     the container (no escape unless the user clicks outside).
 *  2. Stores `document.activeElement` at mount and restores focus to
 *     it when the trap unmounts (modal close → focus returns to the
 *     button that opened it · screen-reader-friendly).
 *  3. Auto-focuses the first focusable inside the container on
 *     mount (skippable when the modal already auto-focuses an
 *     `<input autoFocus>`). */

import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface UseFocusTrapOpts {
  /** When false, the trap is disabled (no listeners installed, no
   *  focus mutations). Used so callers can mount the hook
   *  unconditionally and toggle activation via state. */
  active: boolean;
  /** Skip auto-focusing the first focusable on mount. Useful when
   *  the container already has an `<input autoFocus>` — re-focusing
   *  would steal focus mid-render. Default false. */
  skipInitialFocus?: boolean;
}

/** Find all focusable descendants of `root`. Order matches DOM
 *  order so Tab cycles correctly. */
export function findFocusable(root: HTMLElement): HTMLElement[] {
  const matches = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  // Filter out elements that are inert (display:none / visibility:hidden /
  // ancestor-disabled). querySelector matches them by default; we want
  // only actually-focusable elements. `offsetParent === null` is the
  // standard cheap check for "rendered + visible" excluding fixed-position
  // edge cases, so combine with explicit hidden checks.
  return matches.filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return true;
  });
}

export function useFocusTrap(opts: UseFocusTrapOpts) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!opts.active) return;
    const container = ref.current;
    if (!container) return;

    // Store previously focused element so we can restore on close.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Auto-focus the first focusable inside the container unless the
    // caller opted out (e.g., they have <input autoFocus>).
    if (!opts.skipInitialFocus) {
      const focusables = findFocusable(container);
      if (focusables.length > 0) {
        focusables[0]?.focus();
      } else {
        // No focusables → focus the container itself so keyboard events
        // still reach our listener.
        container.tabIndex = -1;
        container.focus();
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const focusables = findFocusable(container!);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      // Shift+Tab on first → last (wrap backward).
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
        return;
      }
      // Tab on last → first (wrap forward).
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      // Restore focus to the trigger so keyboard users land back where
      // they came from (only when the previously focused element is
      // still in the DOM and focusable).
      if (previouslyFocused && document.body.contains(previouslyFocused)) {
        try { previouslyFocused.focus(); } catch { /* swallow */ }
      }
    };
  }, [opts.active, opts.skipInitialFocus]);

  return ref;
}
