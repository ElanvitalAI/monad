import { C } from '../tui.js';

export type CompactBoundaryReason = 'manual' | 'partial' | 'auto';

function describeReason(reason: CompactBoundaryReason, detail?: string): string {
  if (reason === 'manual') return 'manual /compact';
  if (reason === 'partial') return detail ? `partial /compact · kept ${detail}` : 'partial /compact';
  return detail ? `auto-compact · ${detail}` : 'auto-compact';
}

export function renderCompactBoundary(reason: CompactBoundaryReason, detail?: string): string {
  const label = `✻ Conversation compacted · ${describeReason(reason, detail)} · Ctrl+O for history`;
  return C.dim(`──── ${label} ────`);
}
