// ── thinking-line engine 뱃지 렌더 (2026-07-17) ──────────────────────────
//
// 완료 라인 `✔ Streaming (19s · ↓ 200 tokens · 🧠 terra(high))` — metrics.engine
// 이 detail 파렌테티컬의 마지막 세그먼트로 실려야 한다(live 렌더 + freeze 둘 다).

import { describe, it, expect } from 'bun:test';
import { startThinking, startPinnedThinking } from './thinking-line.js';

describe('thinking-line — engine 뱃지', () => {
  it('startThinking.stop() 완료 라인에 engine 이 실린다', () => {
    const chatLines: string[] = [];
    const h = startThinking({
      chatLines,
      onFrame: () => {},
      message: 'Streaming',
      intervalMs: 0, // 타이머 없음 — 결정론
      metrics: { startedAt: Date.now(), engine: '🧠 terra(high)' },
    });
    h.stop({ status: 'completed' });
    const frozen = chatLines[chatLines.length - 1] ?? '';
    expect(frozen).toContain('🧠 terra(high)');
  });

  it('updateMetrics 로 나중에 주입한 engine 도 freeze 에 반영된다', () => {
    const chatLines: string[] = [];
    const h = startThinking({
      chatLines,
      onFrame: () => {},
      message: 'Streaming',
      intervalMs: 0,
      metrics: { startedAt: Date.now() },
    });
    h.updateMetrics({ engine: '🤖 acp-codex' });
    h.stop({ status: 'completed' });
    expect(chatLines[chatLines.length - 1] ?? '').toContain('🤖 acp-codex');
  });

  it('engine 미지정 시 뱃지 세그먼트가 없다(회귀 방지)', () => {
    const chatLines: string[] = [];
    const h = startThinking({
      chatLines,
      onFrame: () => {},
      message: 'Streaming',
      intervalMs: 0,
      metrics: { startedAt: Date.now() },
    });
    h.stop({ status: 'completed' });
    expect(chatLines[chatLines.length - 1] ?? '').not.toContain('🧠');
  });

  it('pinned variant 도 engine 을 freeze 라인에 싣는다', () => {
    const target: { current: string | null } = { current: null };
    const h = startPinnedThinking({
      target,
      onFrame: () => {},
      message: 'Streaming',
      intervalMs: 0,
      metrics: { startedAt: Date.now(), engine: '🧠 sol(high)' },
    });
    h.stop({ status: 'completed' });
    expect(target.current ?? '').toContain('🧠 sol(high)');
  });
});
