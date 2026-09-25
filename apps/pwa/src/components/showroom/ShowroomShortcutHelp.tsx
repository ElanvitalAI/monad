'use client';

/** FU.B3 (2026-05-09 night) — Keyboard shortcut help overlay.
 *
 *  Triggered by the `?` shortcut (or programmatically via the
 *  `open` prop). Renders a centered modal listing the
 *  SHORTCUT_DESCRIPTIONS catalog so dogfood users can discover the
 *  bindings without leaving the page. Escape closes; the dialog uses
 *  the same focus trap helper as the save modal so Tab cycle stays
 *  inside.
 */

import { Keyboard, X } from 'lucide-react';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { SHORTCUT_DESCRIPTIONS } from '@/lib/showroom-keyboard-shortcuts';

export interface ShowroomShortcutHelpProps {
  open: boolean;
  onClose: () => void;
}

export function ShowroomShortcutHelp({ open, onClose }: ShowroomShortcutHelpProps) {
  // Trap focus inside the dialog while open. skipInitialFocus=false so
  // the close button (first focusable) auto-focuses on mount.
  const containerRef = useFocusTrap({ active: open, skipInitialFocus: false });
  if (!open) return null;
  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="showroom-shortcut-help-title"
      data-testid="showroom-shortcut-help"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      onClick={(e) => {
        // Click the backdrop (this outer div) closes — but click
        // inside the inner card should not. Stop-propagation on the
        // inner div handles that.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border border-zinc-300 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2
            id="showroom-shortcut-help-title"
            className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            <Keyboard className="size-4" aria-hidden />
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Close shortcut help"
            data-testid="showroom-shortcut-help-close"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <ul
          className="space-y-1.5"
          data-testid="showroom-shortcut-help-list"
        >
          {SHORTCUT_DESCRIPTIONS.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 rounded px-2 py-1 text-xs text-zinc-700 dark:text-zinc-300"
              data-testid={`showroom-shortcut-help-row-${entry.id}`}
            >
              <span>{entry.effect}</span>
              <kbd
                className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {entry.combo}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[10px] text-zinc-500">
          Editable surfaces (input · textarea · contenteditable) suppress
          ⌘⇧&#123;J,M,Y&#125; and <kbd className="font-mono">?</kbd> so typing isn't
          intercepted. <kbd className="font-mono">⌘K</kbd> is the
          intentional exception.
        </p>
      </div>
    </div>
  );
}
