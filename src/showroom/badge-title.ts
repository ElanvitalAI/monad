// Showroom v2 · 3-badge pane title formatter.
//
// Renders the lane spec into a compact `〈role〉 · 〈provider〉 · 〈transport〉`
// title string for `AgentRoomMember.title`. Width-aware: when the
// requested budget is too tight, drops segments in order
// (transport → role → provider truncate).
//
// PLAN: 내부 문서 `PLAN-showroom-v2-lane-handoff-2026-04-28` §D4.
// The pulse animation is inherited automatically from
// virtual-window.ts:1115-1129 via `paneBorderTitle(state)` — this
// formatter only produces the base title string.

const SEPARATOR = ' · ';
const ELLIPSIS = '…';

/** Default soft budget in display columns. Most terminals can render
 *  16-24 char pane titles without overflow; we err on the smaller
 *  side so the full badge fits without ellipsis on common 80-col
 *  splits. */
const DEFAULT_MAX_WIDTH = 24;

export interface LaneBadgeInput {
  readonly role?: string;
  readonly provider: string;
  /** `'pty' | 'acp' | 'auto'` — `'auto'` is rendered verbatim so the
   *  user can see what they asked for. */
  readonly transport?: string;
}

/** Build a display-ready badge string. Pass an explicit `maxWidth`
 *  when the caller knows the rendering budget; otherwise the
 *  function uses a sensible default that fits most splits. */
export function formatLaneBadge(
  input: LaneBadgeInput,
  maxWidth: number = DEFAULT_MAX_WIDTH,
): string {
  const provider = (input.provider ?? '').trim();
  if (!provider) return '?';

  const role = (input.role ?? '').trim();
  const transport = (input.transport ?? '').trim();

  // Tier 1 · full badge.
  const full = joinSegs([role, provider, transport]);
  if (full.length <= maxWidth) return full;

  // Tier 2 · drop transport.
  const noTransport = joinSegs([role, provider]);
  if (noTransport.length <= maxWidth) return noTransport;

  // Tier 3 · drop role.
  if (provider.length <= maxWidth) return provider;

  // Tier 4 · truncate provider with ellipsis.
  if (maxWidth <= 1) return ELLIPSIS;
  return provider.slice(0, Math.max(1, maxWidth - 1)) + ELLIPSIS;
}

function joinSegs(segs: readonly string[]): string {
  const present = segs.filter((s) => s.length > 0);
  return present.join(SEPARATOR);
}
