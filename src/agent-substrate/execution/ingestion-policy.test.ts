import { describe, it, expect } from 'bun:test';
import { resolveIngestionPolicy } from './ingestion-policy.js';
import { formatMemoryContext } from './memory-context.js';

describe('resolveIngestionPolicy — mode-gated 인핸싱 + entry-independent 기억·관측', () => {
  it('monad-apparatus → 인핸싱 기본 ON', () => {
    const p = resolveIngestionPolicy({ entry: 'monad-apparatus' });
    expect(p.enhance).toBe(true);
  });

  it('external-verbatim → 인핸싱 기본 OFF(외부가 프롬프트 엔지니어)', () => {
    const p = resolveIngestionPolicy({ entry: 'external-verbatim' });
    expect(p.enhance).toBe(false);
  });

  it('명시 explicitEnhance 가 mode 기본값보다 우선', () => {
    expect(resolveIngestionPolicy({ entry: 'monad-apparatus', explicitEnhance: false }).enhance).toBe(false);
    expect(resolveIngestionPolicy({ entry: 'external-verbatim', explicitEnhance: true }).enhance).toBe(true);
  });

  it('기억·관측은 어떤 진입이든 항상 ON(entry-independent)', () => {
    for (const entry of ['monad-apparatus', 'external-verbatim'] as const) {
      const p = resolveIngestionPolicy({ entry });
      expect(p.memory).toBe(true);
      expect(p.observe).toBe(true);
    }
  });
});

describe('formatMemoryContext — 가산 블록(프롬프트 무접촉)', () => {
  it('회상 항목을 [memory:...] 블록으로', () => {
    const s = formatMemoryContext(['P0a 라이브 포워딩 수리', 'agent-agnostic 리네임']);
    expect(s).toContain('[monad 기억');
    expect(s).toContain('- [memory: P0a 라이브 포워딩 수리]');
    expect(s).toContain('- [memory: agent-agnostic 리네임]');
  });

  it('빈/공백 항목은 제외, 전부 비면 ""', () => {
    expect(formatMemoryContext(['  ', ''])).toBe('');
    expect(formatMemoryContext([])).toBe('');
  });

  it('출처·시간·종류가 있는 회상 항목은 additive evidence metadata를 보존', () => {
    const s = formatMemoryContext([{
      text: 'verified authoring decision',
      source: 'surface-events/self-awareness',
      timestamp: '2026-08-06T01:02:03.000Z',
      kind: 'impl',
    }]);
    expect(s).toContain('[memory source=surface-events/self-awareness; time=2026-08-06T01:02:03.000Z; kind=impl] verified authoring decision');
  });

  it('200자 초과는 절삭', () => {
    const long = 'x'.repeat(500);
    const s = formatMemoryContext([long]);
    expect(s.length).toBeLessThan(260);
  });
});
