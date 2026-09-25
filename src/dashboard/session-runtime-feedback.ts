import type { FeedbackEnvelope } from '../feedback/envelope.js';

export interface DashboardSessionRuntimeFeedbackDeps {
  muted(line: string): string;
  pushChatLine(line: string): void;
  draw(): void;
  observe(event: 'rendered' | 'empty-ascii-fallback', data: {
    kind: FeedbackEnvelope['kind'];
    phase: FeedbackEnvelope['phase'];
    lineCount: number;
  }): void;
}

export function createDashboardSessionRuntimeFeedback(
  deps: DashboardSessionRuntimeFeedbackDeps,
): (envelope: FeedbackEnvelope) => void {
  const firstEmittedAtByBlockId = new Map<string, number | null>();

  return (envelope) => {
    const lines = envelope.asciiFallback.filter(line => line.trim().length > 0);
    const renderState = lines.length > 0 ? 'rendered' : 'empty-ascii-fallback';
    const hasFirstEnvelope = firstEmittedAtByBlockId.has(envelope.blockId);
    const emittedAt = Number.isFinite(envelope.emittedAt) ? envelope.emittedAt : null;
    const firstEmittedAt = firstEmittedAtByBlockId.get(envelope.blockId);
    if (!hasFirstEnvelope) firstEmittedAtByBlockId.set(envelope.blockId, emittedAt);
    const elapsed = hasFirstEnvelope
      ? typeof firstEmittedAt !== 'number' || emittedAt === null
        ? ' [경과: 시각 없음]'
        : ` [경과: ${Math.max(0, Math.floor((emittedAt - firstEmittedAt) / 1000))}초]`
      : '';
    // ⛔ 관측이 «렌더를 막지 않는다» — 이 자리가 던지면 아래 pushChatLine 에 영영 못 닿아
    //   진행 줄이 통째로 사라진다(무인 리뷰 R4 must-fix ① 계열 · 이음매가 불리는 자리에서 막는다).
    try {
      deps.observe(renderState, {
        kind: envelope.kind,
        phase: envelope.phase,
        lineCount: lines.length,
      });
    } catch {
      // Observability must not prevent the progress line from rendering.
    }
    if (lines.length === 0) return;
    for (const line of lines) deps.pushChatLine(deps.muted(`${line}${elapsed}`));
    deps.draw();
  };
}
