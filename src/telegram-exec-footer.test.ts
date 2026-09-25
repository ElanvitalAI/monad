// ── executionBadge — TUI 완료 라인 진짜-실행 뱃지 (2026-07-17) ──────────────
//
// footer 가 config 원문(opus)을 보여줘 "opus 설정인데 codex 로 돈다" 착시가 났다.
// executionBadge 는 실제 실행 엔진/모델을 한 토큰으로 압축해 완료 라인에 실어,
// self 는 `🧠 terra(high)`, delegate 는 `🤖 acp-codex` 로 진실을 드러낸다.
// acpLabel 을 executionFooter 와 공유하므로 라벨 매핑이 두 표면에서 일치한다.

import { describe, it, expect } from 'bun:test';
import { executionBadge } from './telegram-exec-footer.js';

describe('executionBadge — 진짜-실행 뱃지', () => {
  it('self 턴 model+effort → 🧠 model(effort)', () => {
    expect(executionBadge({ model: 'terra', effort: 'high' })).toBe('🧠 terra(high)');
  });

  it('self 턴 model 만(effort 없음) → 🧠 model', () => {
    expect(executionBadge({ model: 'gpt-5.6-luna' })).toBe('🧠 gpt-5.6-luna');
  });

  it('delegate 는 model 을 무시하고 🤖 acp-<backend>', () => {
    expect(executionBadge({ delegatedBackend: 'codex', model: 'terra' })).toBe('🤖 acp-codex');
    expect(executionBadge({ delegatedBackend: 'claude-sonnet' })).toBe('🤖 acp-claude');
    expect(executionBadge({ delegatedBackend: 'gemini' })).toBe('🤖 acp-gemini');
    expect(executionBadge({ delegatedBackend: 'grok' })).toBe('🤖 acp-grok');
  });

  it('model 도 delegate 도 없으면 🧠 monad (guess 금지)', () => {
    expect(executionBadge({})).toBe('🧠 monad');
  });
});
