import type { SessionsSidebarState } from '../../session/sidebar-widget.js';

export interface SessionSidebarSelection {
  sessionId: string | null;
}

export function focusSessionSidebarCursor(
  state: SessionsSidebarState | null | undefined,
): SessionSidebarSelection {
  if (!state || state.cards.length === 0) return { sessionId: null };
  const idx = Math.max(0, Math.min(state.cursor, state.cards.length - 1));
  state.cursor = idx;
  return { sessionId: state.cards[idx]?.id ?? null };
}

export function cycleSessionSidebarCursor(
  state: SessionsSidebarState | null | undefined,
  delta: 1 | -1,
): SessionSidebarSelection {
  if (!state || state.cards.length === 0) return { sessionId: null };
  const max = state.cards.length - 1;
  state.cursor = Math.max(0, Math.min(max, state.cursor + delta));
  return { sessionId: state.cards[state.cursor]?.id ?? null };
}

export function revealSessionInSidebar(
  state: SessionsSidebarState | null | undefined,
  sessionId: string,
): boolean {
  if (!state) return false;
  const idx = state.cards.findIndex(c => c.id === sessionId);
  if (idx < 0) return false;
  state.cursor = idx;
  return true;
}
