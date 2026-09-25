// codex-mission 순수 파서 테스트 — 특히 testGate 거짓실패 버그 회귀 방지.
import { describe, test, expect } from 'bun:test';
import { parseTestOutput, parseTscErrors, parseBrainDecision, screenSignalsComplete, screenNeedsTrust } from './parse.js';

describe('parseTestOutput (testGate 버그 수정)', () => {
  test('"2 pass 0 fail" → ok=true (0 fail 의 fail 문자열에 속지 않음)', () => {
    const o = '\n 2 pass\n 0 fail\n 2 expect() calls\nRan 2 tests across 1 file.';
    const r = parseTestOutput(o);
    expect(r.ok).toBe(true); expect(r.pass).toBe(2); expect(r.fail).toBe(0);
  });
  test('"3 pass 1 fail" → ok=false', () => {
    const r = parseTestOutput(' 3 pass\n 1 fail');
    expect(r.ok).toBe(false); expect(r.fail).toBe(1);
  });
  test('no tests → ok=false', () => {
    expect(parseTestOutput('some error output').ok).toBe(false);
  });

  // ⭐OH8 — 실행 규모 증거(ranFiles) 로 "exit0/pass 흡수" 거짓 통과 차단.
  test('요약 파싱 — ranTests/ranFiles (단수 file)', () => {
    const r = parseTestOutput('\n 11 pass\n 0 fail\nRan 11 tests across 1 file. [26ms]');
    expect(r.ranTests).toBe(11); expect(r.ranFiles).toBe(1); expect(r.hasRunSummary).toBe(true); expect(r.ok).toBe(true);
  });
  test('복수 files 파싱', () => {
    const r = parseTestOutput(' 40 pass\n 0 fail\nRan 40 tests across 3 files.');
    expect(r.ranFiles).toBe(3); expect(r.ok).toBe(true);
  });
  test('★ pass>0·fail0 이어도 0 파일이면 ok=false (33 pass/exit0 사고 방지)', () => {
    const r = parseTestOutput(' 33 pass\n 0 fail\nRan 33 tests across 0 files.');
    expect(r.pass).toBe(33); expect(r.fail).toBe(0);
    expect(r.ranFiles).toBe(0);
    expect(r.ok).toBe(false); // ← 종전엔 true 로 거짓 통과했다
  });
  test('요약 없으면 하위호환 — pass>0·fail0 → ok=true', () => {
    const r = parseTestOutput(' 5 pass\n 0 fail');
    expect(r.hasRunSummary).toBe(false); expect(r.ok).toBe(true);
  });
});

describe('parseTscErrors', () => {
  test('error TS 라인만 추출', () => {
    const o = 'src/a.ts(1,2): error TS2304: Cannot find name.\nok line\nsrc/b.ts(3,4): error TS1005: expected.';
    expect(parseTscErrors(o)).toHaveLength(2);
  });
  test('0 errors → []', () => {
    expect(parseTscErrors('all good\n')).toEqual([]);
  });
});

describe('parseBrainDecision', () => {
  test('valid json', () => {
    const d = parseBrainDecision('결정: {"action":"verify","reason":"codex 완료주장"}');
    expect(d.action).toBe('verify'); expect(d.reason).toContain('완료');
  });
  test('search with query', () => {
    const d = parseBrainDecision('{"action":"search","query":"bun test typescript","reason":"막힘"}');
    expect(d.action).toBe('search'); expect(d.query).toBe('bun test typescript');
  });
  test('provision with spec/layer (P4)', () => {
    const d = parseBrainDecision('{"action":"provision","spec":"lodash","layer":"pkg","reason":"module not found"}');
    expect(d.action).toBe('provision'); expect(d.spec).toBe('lodash'); expect(d.layer).toBe('pkg');
  });
  test('unknown action → wait', () => {
    expect(parseBrainDecision('{"action":"frobnicate"}').action).toBe('wait');
  });
  test('no json → wait fallback', () => {
    expect(parseBrainDecision('no json here').action).toBe('wait');
  });
});

describe('screen signals', () => {
  test('MISSION-COMPLETE 감지', () => {
    expect(screenSignalsComplete('...\n• MISSION-COMPLETE\n')).toBe(true);
    expect(screenSignalsComplete('still working')).toBe(false);
  });
  test('trust 프롬프트 감지', () => {
    expect(screenNeedsTrust('Do you trust the contents of this directory?')).toBe(true);
    expect(screenNeedsTrust('normal screen')).toBe(false);
  });
});
