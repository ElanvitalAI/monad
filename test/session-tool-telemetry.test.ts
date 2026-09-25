import { describe, expect, test } from 'bun:test';

import { truncateForPersist, buildToolTraceMessage } from '../src/session/chat.js';

describe('truncateForPersist', () => {
  test('짧은 문자열 그대로', () => {
    expect(truncateForPersist('hello', 100)).toBe('hello');
  });

  test('긴 문자열 잘라내기 + 잔여 표기', () => {
    const long = 'x'.repeat(3000);
    const r = truncateForPersist(long, 2000);
    expect(r.startsWith('x'.repeat(2000))).toBe(true);
    expect(r).toContain('(+1000 chars)');
    expect(r.length).toBeLessThan(long.length);
  });

  test('객체 → JSON 직렬화', () => {
    expect(truncateForPersist({ a: 1, b: 'x' }, 100)).toBe('{"a":1,"b":"x"}');
  });

  test('순환/직렬화 불가 → String 폴백(throw 안 함)', () => {
    const circ: any = {}; circ.self = circ;
    const r = truncateForPersist(circ, 100);
    expect(typeof r).toBe('string');  // 폴백 성공(예외 없음)
  });
});

describe('buildToolTraceMessage', () => {
  test('role=tool + toolName/args/result + content 라벨', () => {
    const m = buildToolTraceMessage('WebSearch', { query: '헬리코프리온' }, 'result text');
    expect(m.role).toBe('tool');
    expect(m.toolName).toBe('WebSearch');
    expect(m.toolArgs).toBe('{"query":"헬리코프리온"}');
    expect(m.toolResult).toBe('result text');
    expect(m.content).toBe('⚙️ WebSearch');
    expect(typeof m.ts).toBe('string');
    expect(m.tokenEstimate).toBeGreaterThanOrEqual(0);
  });

  test('큰 결과는 잘려서 저장(session bloat 방지)', () => {
    const big = 'y'.repeat(5000);
    const m = buildToolTraceMessage('finance_kr_flow', { command: 'krx-options' }, big);
    expect((m.toolResult as string).length).toBeLessThan(big.length);
    expect(m.toolResult).toContain('chars)');
  });

  test('큰 인자도 잘림', () => {
    const m = buildToolTraceMessage('Edit', { content: 'z'.repeat(3000) }, 'ok');
    expect((m.toolArgs as string).length).toBeLessThanOrEqual(1100);
  });
});
