'use client';

/** FU.B2 (2026-05-09 night) — ARIA live-region announcer for the
 *  Showroom polish §2.
 *
 *  Screen readers announce text added to a `aria-live="polite"`
 *  region without moving keyboard focus. We use this to surface
 *  state changes that have no visible target (e.g., voice phase
 *  transitions, layout save/load success, judge toggle) so SR users
 *  get the same feedback sighted users get from pill colour changes.
 *
 *  Design:
 *  - One `aria-live="polite" aria-atomic="true"` region per layout
 *    (rendered once · `<LiveRegion message={…} />`).
 *  - `useLiveAnnouncer()` returns `{ message, announce(text) }`.
 *  - `announce(text)` updates the message; if the same text is
 *    announced twice in a row, we toggle a trailing zero-width
 *    space so the SR re-reads it (otherwise `aria-live` deduplicates
 *    identical strings).
 *  - Verbosity is intentionally low: short subject-verb phrases
 *    ("Layout saved", "Voice listening", "Judge: LLM") so the SR
 *    queue doesn't overflow during fast toggles.
 */

import { useCallback, useRef, useState } from 'react';

const ZERO_WIDTH_SPACE = '​';

export interface LiveAnnouncerHandle {
  /** Current message — bind to the live region's text node. */
  message: string;
  /** Push a new announcement. Identical-text repeats are made
   *  unique via a trailing zero-width space so the SR re-reads. */
  announce: (text: string) => void;
}

export function useLiveAnnouncer(): LiveAnnouncerHandle {
  const [message, setMessage] = useState('');
  const lastRef = useRef('');

  const announce = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Toggle a trailing zero-width space when the same text is
    // announced twice in a row (some SRs deduplicate identical
    // aria-live updates).
    const next = trimmed === lastRef.current
      ? trimmed + ZERO_WIDTH_SPACE
      : trimmed;
    lastRef.current = next;
    setMessage(next);
  }, []);

  return { message, announce };
}

/** Format helpers for the most common state transitions — keep
 *  phrases short and consistent so the SR queue stays predictable. */
export const announcements = {
  layoutSaved: (name: string) =>
    name ? `Layout "${name}" saved` : 'Layout saved',
  layoutLoaded: (name: string) =>
    name ? `Layout "${name}" loaded` : 'Layout loaded',
  layoutDeleted: (name: string) =>
    name ? `Layout "${name}" deleted` : 'Layout deleted',
  judgeToggled: (backend: 'keyword' | 'local-llm') =>
    backend === 'local-llm' ? 'Role judge: LLM' : 'Role judge: keyword',
  voiceToggled: (active: boolean) =>
    active ? 'Voice mode on · listening' : 'Voice mode off',
  voicePhase: (phase: string) => `Voice ${phase}`,
  ttsMuted: (muted: boolean) => muted ? 'TTS muted' : 'TTS unmuted',
  modelChanged: (modelId: string) =>
    modelId ? `Model: ${modelId}` : 'Model: daemon default',
  panelAdded: (kind: 'chat' | 'agent', label?: string) =>
    label ? `Added ${kind} panel: ${label}` : `Added ${kind} panel`,
  panelRemoved: (label?: string) =>
    label ? `Removed panel: ${label}` : 'Panel removed',
  shortcutFired: (effect: string) => effect, // already-formatted phrase
};
