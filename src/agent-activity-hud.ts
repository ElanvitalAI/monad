// Agent-activity HUD segment — T3-B1.
//
// Dashboard's HUD bar gains a pulsing "N agent(s) running" indicator
// so the user can see at a glance when background sub-agent work
// is in flight. The pulse (500ms half-period) makes the segment
// visually distinct from static state segments next to it.
//
// Semantics:
//
//   • running=0  → immediate-abort Escape hint
//   • running=1-2 → orange glyph + count + confirmation Escape hint
//   • running≥3  → red glyph + count (visual pressure)
//
// The glyph toggles between two shapes every 500ms:
//   • PHASE_A: ●  (filled)
//   • PHASE_B: ○  (outlined)
//
// Pulse state is derived from `now()` so the dashboard's existing
// animation tick (or any redraw) always paints the right frame.
// The dashboard only needs to ensure redraws happen while agents
// are active — which the existing agent-surface subscriber already
// does on every tool-call event.

import { C } from './tui.js';

export const AGENT_ACTIVITY_SEGMENT_KEY = 'agent-activity';
export const PULSE_HALF_PERIOD_MS = 500;

/** Derive the current pulse phase from a timestamp. `A` on even
 *  half-seconds, `B` on odd. Deterministic so tests can pin it. */
export function pulsePhase(now: number): 'A' | 'B' {
  return Math.floor(now / PULSE_HALF_PERIOD_MS) % 2 === 0 ? 'A' : 'B';
}

/** Build the HUD segment string for N running agents, including the
 *  context-specific Escape action that will run during streaming. */
export function renderAgentActivitySegment(
  running: number,
  now: number = Date.now(),
): string | null {
  const phase = pulsePhase(now);
  if (running <= 0) return C.muted('Esc abort now');
  const glyph = phase === 'A' ? '●' : '○';
  const countStr = running === 1 ? '1 agent' : `${running} agents`;
  // ⭐ 여기는 `running > 0` 이 이미 보장된다(위 조기 반환) — 삼항의 false 갈래는
  //    도달 불가라 오해를 만든다(무인 리뷰 should-fix).
  const escHint = 'Esc confirm abort';
  const colored = running >= 3 ? C.error(glyph) : C.warning(glyph);
  return `${colored} ${C.text(countStr)} · ${C.muted(escHint)}`;
}
