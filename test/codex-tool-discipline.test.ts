// CODEX_TOOL_DISCIPLINE — the leading system message injected for the codex
// family. Locks the invariants; E (2026-07-19) adds the verification-scope rule
// after an iv6 drive ran the full `bun test` suite for a 3-file rewire.

import { describe, test, expect } from 'bun:test';
import { CODEX_TOOL_DISCIPLINE } from '../src/llm.js';

describe('CODEX_TOOL_DISCIPLINE', () => {
  test('is a single leading system message', () => {
    expect(CODEX_TOOL_DISCIPLINE.startsWith('[codex tool-use discipline]')).toBe(true);
  });

  test('keeps the core exploration rules', () => {
    expect(CODEX_TOOL_DISCIPLINE).toContain('넓게 시작하라');
    expect(CODEX_TOOL_DISCIPLINE).toContain('같은 검색을 반복하지 마라');
    expect(CODEX_TOOL_DISCIPLINE).toContain('다시 읽지 마라');
  });

  test('E — verification is scoped to the change; no full bun test suite', () => {
    expect(CODEX_TOOL_DISCIPLINE).toContain('검증은 변경 범위에 맞춰라');
    expect(CODEX_TOOL_DISCIPLINE).toContain('전체 `bun test`');
    // must tell the model NOT to run it and to lean on CI instead
    expect(CODEX_TOOL_DISCIPLINE).toMatch(/CI 가 나중에 돌리니 실행하지 마라/);
    expect(CODEX_TOOL_DISCIPLINE).toContain('무한정 기다리지 마라');
  });
});
