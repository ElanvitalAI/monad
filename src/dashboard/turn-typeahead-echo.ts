export type TurnTypeaheadDrainResult = {
  nextInitial: string | undefined;
  injectEnter: boolean;
};

const MAX_ECHO_CODE_POINTS = 80;

/** Formats a quiet chat-log reflection for a queued submission drained into the next turn. */
export function wireDashboardTurnTypeaheadEcho(
  drained: TurnTypeaheadDrainResult,
): string | null {
  if (!drained.injectEnter || !drained.nextInitial) return null;

  const displayText = drained.nextInitial.replace(/[\r\n]+/g, ' ');
  const codePoints = [...displayText];
  const truncated = codePoints.length > MAX_ECHO_CODE_POINTS;
  const shown = truncated
    ? `${codePoints.slice(0, MAX_ECHO_CODE_POINTS).join('')}…`
    : displayText;

  // ⭐ 사용자 줄은 이 저장소 관례대로 한국어다(`⏹️ 중단했습니다.` · `[quit] … 중단했습니다`).
  return `  ⏎ 대기했던 요청을 보냈습니다 · "${shown}"${truncated ? ' (잘림)' : ''}`;
}
