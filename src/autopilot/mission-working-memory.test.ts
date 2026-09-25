import { describe, it, expect } from 'bun:test';
import {
  parseWorkingMemoryJsonl,
  formatWorkingMemoryForPrompt,
  formatWorkingMemoryDigest,
  parseWorkingMemorySignals,
  parseDeviation,
  stripWorkingMemoryMarker,
  dedupWorkingMemory,
  appendWorkingMemory,
  readWorkingMemory,
  resetWorkingMemory,
  missionWorkingMemoryPath,
  isWorkingMemoryScope,
  type WorkingMemoryEntry,
} from './mission-working-memory.js';
import { rmSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

const entry = (o: Partial<WorkingMemoryEntry>): WorkingMemoryEntry => ({
  phaseId: 'task:abc', phaseTitle: 'p', kind: 'investigation', at: '2026-07-13T00:00:00Z',
  summary: 's', reusables: [], decisions: [], artifacts: [], ...o,
});

describe('parseWorkingMemoryJsonl', () => {
  it('parses valid lines and skips blank/broken lines', () => {
    const text = [
      JSON.stringify({ phaseId: 't1', phaseTitle: 'A', kind: 'investigation', at: 'x', summary: 'sa', reusables: ['r1'], decisions: [], artifacts: [] }),
      '',
      'not-json{',
      JSON.stringify({ phaseId: 't2', phaseTitle: 'B', kind: 'implementation', at: 'y', summary: 'sb', reusables: [], decisions: ['d1'], artifacts: ['PR#1'] }),
    ].join('\n');
    const out = parseWorkingMemoryJsonl(text);
    expect(out.length).toBe(2);
    expect(out[0]!.phaseTitle).toBe('A');
    expect(out[0]!.reusables).toEqual(['r1']);
    expect(out[1]!.kind).toBe('implementation');
    expect(out[1]!.artifacts).toEqual(['PR#1']);
  });

  it('defaults unknown kind to investigation and normalizes lists', () => {
    const out = parseWorkingMemoryJsonl(JSON.stringify({ phaseId: 't', kind: 'weird', reusables: ['a', 'a', ' b '] }));
    expect(out[0]!.kind).toBe('investigation');
    expect(out[0]!.reusables).toEqual(['a', 'b']); // dedup + trim
  });

  it('returns [] for empty text', () => {
    expect(parseWorkingMemoryJsonl('')).toEqual([]);
    expect(parseWorkingMemoryJsonl('\n\n')).toEqual([]);
  });

  it('provenance 파싱: external/reconcile/decision/build 인정·그 외 self 기본(하위호환)', () => {
    const text = [
      JSON.stringify({ phaseId: 'a', provenance: 'external' }),
      JSON.stringify({ phaseId: 'b', provenance: 'reconcile' }),
      JSON.stringify({ phaseId: 'c' }), // 구버전(provenance 없음) → self
      JSON.stringify({ phaseId: 'd', provenance: 'bogus' }), // 미지정값 → self
      JSON.stringify({ phaseId: 'e', provenance: 'build' }), // ★축2 빌드 조사문맥 이관 → build 인정
    ].join('\n');
    const out = parseWorkingMemoryJsonl(text);
    expect(out.map((e) => e.provenance)).toEqual(['external', 'reconcile', 'self', 'self', 'build']);
  });
});

describe('formatWorkingMemoryForPrompt', () => {
  it('★reconcile(상태 관측)은 빌드 프롬프트 주입에서 제외(self/external 만 재사용 컨텍스트)', () => {
    const out = formatWorkingMemoryForPrompt([
      entry({ phaseTitle: '조사', reusables: ['finance-tools:x'], provenance: 'self' }),
      entry({ phaseTitle: '재인지', summary: 'PR closed landed-elsewhere', decisions: ['드리프트'], provenance: 'reconcile' }),
    ]);
    expect(out).toContain('finance-tools:x'); // self 재사용은 주입됨
    expect(out).not.toContain('드리프트'); // reconcile 결정은 주입 안 됨
    expect(out).not.toContain('재인지'); // reconcile 페이즈 요약도 제외
  });

  it('returns empty string when no entries', () => {
    expect(formatWorkingMemoryForPrompt([])).toBe('');
  });

  it('★축2 빌드 조사문맥(scope:global·provenance:build)은 다른 실행 페이즈에도 자동 주입(재조사 방지)', () => {
    const out = formatWorkingMemoryForPrompt([
      entry({ phaseId: 'build:context', phaseTitle: '빌드 조사 문맥', summary: '딥리서치 발견 3건', reusables: ['src/existing-absorb.ts'], decisions: ['교정: youtube absorb 재사용'], provenance: 'build', scope: 'global' }),
    ], { viewerPhaseId: 'task:other-phase' }); // 다른 페이즈가 봐도 global 이라 주입
    expect(out).toContain('src/existing-absorb.ts'); // 재사용 경계 주입됨
    expect(out).toContain('youtube absorb 재사용'); // 빌드 교정 주입됨
  });

  it('★축2 대비: agent 스코프는 소유 페이즈만(build global 과 대비)', () => {
    const out = formatWorkingMemoryForPrompt([
      entry({ phaseId: 'task:owner', phaseTitle: '사적', reusables: ['private:x'], scope: 'agent' }),
    ], { viewerPhaseId: 'task:other' }); // 다른 페이즈 → agent 엔트리 안 보임
    expect(out).not.toContain('private:x');
  });

  it('★P3 build:context 재빌드 중복 제거 — 같은 phaseId build 는 최신 1개만', () => {
    const out = formatWorkingMemoryForPrompt([
      entry({ phaseId: 'build:context', summary: '옛 조사', reusables: ['old-reuse.ts'], provenance: 'build', scope: 'global' }),
      entry({ phaseId: 'build:context', summary: '새 조사', reusables: ['new-reuse.ts'], provenance: 'build', scope: 'global' }),
    ]);
    expect(out).toContain('new-reuse.ts'); // 최신 build 유지
    expect(out).not.toContain('old-reuse.ts'); // 옛 build 중복 제거
  });

  it('aggregates reusables and decisions across phases (deduped)', () => {
    const out = formatWorkingMemoryForPrompt([
      entry({ phaseTitle: '조사', reusables: ['finance-tools:quoteToMarketSignal', 'signal-pool:ingest'], decisions: ['S4 승격은 gate1 재사용'] }),
      entry({ phaseTitle: '구현', kind: 'implementation', reusables: ['finance-tools:quoteToMarketSignal'] }),
    ]);
    expect(out).toContain('재사용 필수');
    expect(out).toContain('finance-tools:quoteToMarketSignal');
    expect(out).toContain('signal-pool:ingest');
    expect(out).toContain('S4 승격은 gate1 재사용');
    // dedup: quoteToMarketSignal appears once in the reusables list section
    const reuseCount = (out.match(/finance-tools:quoteToMarketSignal/g) ?? []).length;
    expect(reuseCount).toBe(1);
  });

  it('includes a per-phase summary line with kind tag', () => {
    const out = formatWorkingMemoryForPrompt([entry({ phaseTitle: '경계 조사', summary: '재사용 경계 파악' })]);
    expect(out).toContain('[조사] 경계 조사');
  });

  it('아크 메모리 2층(A4) — arcId 주면 같은 아크 메이트 강조', () => {
    const entries = [
      entry({ phaseId: 'p1', arcId: 'arc_A_0', reusables: ['SignalEnvelope'], decisions: ['narrow waist'] }),
      entry({ phaseId: 'p3', arcId: 'arc_B_1', reusables: ['orchestrate'] }),
    ];
    const out = formatWorkingMemoryForPrompt(entries, { arcId: 'arc_A_0' });
    expect(out).toContain('같은 아크(arc_A_0)');
    expect(out).toContain('(아크 재사용) SignalEnvelope');
    expect(out).toContain('(아크 결정) narrow waist');
  });

  it('arcId 없으면 아크 강조 섹션 없음(회귀 0)', () => {
    const out = formatWorkingMemoryForPrompt([entry({ arcId: 'arc_A_0', reusables: ['X'] })]);
    expect(out).not.toContain('같은 아크');
  });
});

describe('formatWorkingMemoryDigest', () => {
  it('handles empty', () => {
    expect(formatWorkingMemoryDigest([])).toContain('비어 있음');
  });

  it('numbers phases and shows reusables/decisions/artifacts', () => {
    const out = formatWorkingMemoryDigest([
      entry({ phaseTitle: 'A', reusables: ['r1'], decisions: ['d1'], artifacts: ['PR#9'] }),
    ]);
    expect(out).toContain('1. [조사] A');
    expect(out).toContain('재사용: r1');
    expect(out).toContain('결정: d1');
    expect(out).toContain('산출: PR#9');
  });
});

describe('stripWorkingMemoryMarker (보고 정제)', () => {
  it('removes the marker + JSON block, keeps surrounding text', () => {
    const text = '조사 완료. 재사용 경계 파악.\n[WORKING-MEMORY]\n{"reusables":["a"],"decisions":[],"summary":"x"}\nVERDICT: PASS';
    const out = stripWorkingMemoryMarker(text);
    expect(out).not.toContain('[WORKING-MEMORY]');
    expect(out).not.toContain('reusables');
    expect(out).toContain('조사 완료');
    expect(out).toContain('VERDICT: PASS');
  });

  it('handles nested braces in the block', () => {
    const out = stripWorkingMemoryMarker('본문\n[WORKING-MEMORY]\n{"summary":"a {b} c","extra":{"k":1}}\n끝');
    expect(out).not.toContain('WORKING-MEMORY');
    expect(out).toContain('본문');
    expect(out).toContain('끝');
  });

  it('returns text unchanged when no marker', () => {
    expect(stripWorkingMemoryMarker('그냥 보고입니다')).toBe('그냥 보고입니다');
  });

  it('handles marker with no valid JSON (truncated)', () => {
    const out = stripWorkingMemoryMarker('본문\n[WORKING-MEMORY]\n{broken');
    expect(out).toBe('본문');
  });
});

describe('dedupWorkingMemory (재구현/rerun 방어)', () => {
  it('keeps only the latest entry per phaseId', () => {
    const out = dedupWorkingMemory([
      entry({ phaseId: 't1', summary: 'v1', reusables: ['old'] }),
      entry({ phaseId: 't2', summary: 'other' }),
      entry({ phaseId: 't1', summary: 'v2', reusables: ['new'] }), // rebuild of t1
    ]);
    expect(out.length).toBe(2);
    const t1 = out.find((e) => e.phaseId === 't1')!;
    expect(t1.summary).toBe('v2');
    expect(t1.reusables).toEqual(['new']);
  });

  it('moves re-recorded phase to latest position', () => {
    const out = dedupWorkingMemory([
      entry({ phaseId: 'a', summary: 'a1' }),
      entry({ phaseId: 'b', summary: 'b1' }),
      entry({ phaseId: 'a', summary: 'a2' }), // a re-recorded → should be last
    ]);
    expect(out.map((e) => e.phaseId)).toEqual(['b', 'a']);
  });

  it('falls back to title@at key when phaseId is empty', () => {
    const out = dedupWorkingMemory([
      entry({ phaseId: '', phaseTitle: 'X', at: 't1' }),
      entry({ phaseId: '', phaseTitle: 'X', at: 't2' }),
    ]);
    expect(out.length).toBe(2); // different at → distinct
  });
});

describe('append/read IO (강제 종료·부분 쓰기 방어)', () => {
  const MID = 'apm_test-working-memory-unit_zzzz';
  const cleanup = () => { try { rmSync(dirname(missionWorkingMemoryPath(MID)), { recursive: true, force: true }); } catch { /* noop */ } };

  it('round-trips append → read with dedup, tolerates a truncated trailing line', () => {
    cleanup();
    appendWorkingMemory(MID, { phaseId: 't1', phaseTitle: '조사', kind: 'investigation', summary: 's1', reusables: ['r1'], decisions: [], artifacts: [] });
    appendWorkingMemory(MID, { phaseId: 't1', phaseTitle: '조사', kind: 'investigation', summary: 's1-redo', reusables: ['r1', 'r2'], decisions: [], artifacts: [] });
    // 강제 종료로 잘린 부분 줄(개행 없음) 흉내 — 파서가 skip 해야 함.
    try { appendFileSync(missionWorkingMemoryPath(MID), '{"phaseId":"t2","summ'); } catch { /* noop */ }
    const out = readWorkingMemory(MID);
    expect(out.length).toBe(1); // t1 dedup → 최신, 잘린 t2 는 skip
    expect(out[0]!.summary).toBe('s1-redo');
    expect(out[0]!.reusables).toEqual(['r1', 'r2']);
    cleanup();
  });

  it('returns [] for a mission with no memory file', () => {
    cleanup();
    expect(readWorkingMemory(MID)).toEqual([]);
  });

  it('resetWorkingMemory archives the file so reads start fresh (revise 방어)', () => {
    cleanup();
    appendWorkingMemory(MID, { phaseId: 'g0', phaseTitle: '구세대', kind: 'investigation', summary: 'stale', reusables: ['old-boundary'], decisions: [], artifacts: [] });
    expect(readWorkingMemory(MID).length).toBe(1);
    resetWorkingMemory(MID, 'revise');
    expect(readWorkingMemory(MID)).toEqual([]); // 리셋 후 fresh
    // 새 세대 append 는 정상 축적
    appendWorkingMemory(MID, { phaseId: 'g1', phaseTitle: '새세대', kind: 'investigation', summary: 'fresh', reusables: [], decisions: [], artifacts: [] });
    const out = readWorkingMemory(MID);
    expect(out.length).toBe(1);
    expect(out[0]!.phaseTitle).toBe('새세대');
    cleanup();
  });

  it('resetWorkingMemory on a missing file is a no-op (never throws)', () => {
    cleanup();
    expect(() => resetWorkingMemory(MID, 'revise')).not.toThrow();
  });

  it('append never throws on a nonsense mission id', () => {
    expect(() => appendWorkingMemory('', { phaseId: 'x', phaseTitle: 't', kind: 'operational', summary: 's', reusables: [], decisions: [], artifacts: [] })).not.toThrow();
    try { rmSync(dirname(missionWorkingMemoryPath('')), { recursive: true, force: true }); } catch { /* noop */ }
  });
});

describe('parseWorkingMemorySignals', () => {
  it('extracts marked JSON block', () => {
    const text = [
      '조사 결과 보고합니다. 재사용 경계는 다음과 같습니다.',
      '[WORKING-MEMORY]',
      '{"reusables": ["replay-loader:load", "finance-tools:inject"], "decisions": ["Telegram transport 재사용"], "summary": "3개 경계 파악"}',
      'VERDICT: PASS',
    ].join('\n');
    const r = parseWorkingMemorySignals(text);
    expect(r.reusables).toEqual(['replay-loader:load', 'finance-tools:inject']);
    expect(r.decisions).toEqual(['Telegram transport 재사용']);
    expect(r.summary).toBe('3개 경계 파악');
  });

  it('handles nested braces in JSON', () => {
    const text = '[WORKING-MEMORY]\n{"reusables":["a"],"decisions":[],"summary":"has {nested} text","extra":{"k":1}}';
    const r = parseWorkingMemorySignals(text);
    expect(r.reusables).toEqual(['a']);
    expect(r.summary).toContain('nested');
  });

  it('falls back to text prefix when no marker', () => {
    const r = parseWorkingMemorySignals('그냥 자유 서술 보고입니다. 재사용 경계 없음.');
    expect(r.reusables).toEqual([]);
    expect(r.decisions).toEqual([]);
    expect(r.summary).toContain('자유 서술');
  });

  it('falls back on broken JSON', () => {
    const r = parseWorkingMemorySignals('[WORKING-MEMORY]\n{broken json');
    expect(r.reusables).toEqual([]);
    expect(r.summary).toContain('broken');
  });

  it('handles empty text', () => {
    const r = parseWorkingMemorySignals('');
    expect(r).toEqual({ summary: '', reusables: [], decisions: [] });
  });
});

describe('parseDeviation (E1 구현 이탈·순수)', () => {
  it('유효 kind+note → {kind,note}', () => {
    expect(parseDeviation({ kind: 'scope_reduction', note: '환경 제약으로 API 2개만' })).toEqual({ kind: 'scope_reduction', note: '환경 제약으로 API 2개만' });
  });
  it('note 없거나 공백이면 무이탈(undefined)', () => {
    expect(parseDeviation({ kind: 'deferred' })).toBeUndefined();
    expect(parseDeviation({ kind: 'deferred', note: '  ' })).toBeUndefined();
  });
  it('kind 미상/누락 → other 폴백', () => {
    expect(parseDeviation({ kind: 'weird', note: 'x' })).toEqual({ kind: 'other', note: 'x' });
    expect(parseDeviation({ note: 'y' })).toEqual({ kind: 'other', note: 'y' });
  });
  it('비객체 → undefined', () => {
    expect(parseDeviation(null)).toBeUndefined();
    expect(parseDeviation('str')).toBeUndefined();
    expect(parseDeviation(undefined)).toBeUndefined();
  });
  it('note 공백 정규화', () => {
    expect(parseDeviation({ kind: 'other', note: 'a  b\n\nc' })?.note).toBe('a b c');
  });
});

describe('parseWorkingMemorySignals — deviation 파싱(E1)', () => {
  it('WORKING-MEMORY JSON 의 deviation 을 파싱', () => {
    const text = 'blah\n[WORKING-MEMORY]\n{"reusables":[],"decisions":[],"summary":"s","deviation":{"kind":"asked_user","note":"범위 모호해 되물음"}}';
    expect(parseWorkingMemorySignals(text).deviation).toEqual({ kind: 'asked_user', note: '범위 모호해 되물음' });
  });
  it('deviation 없으면 필드 생략', () => {
    const text = '[WORKING-MEMORY]\n{"reusables":[],"decisions":[],"summary":"s"}';
    expect(parseWorkingMemorySignals(text).deviation).toBeUndefined();
  });
});

describe('축A scope 가시성 필터 (A1 국소 메모리 계층)', () => {
  it('isWorkingMemoryScope 검증(순수)', () => {
    expect(isWorkingMemoryScope('agent')).toBe(true);
    expect(isWorkingMemoryScope('subteam')).toBe(true);
    expect(isWorkingMemoryScope('global')).toBe(true);
    expect(isWorkingMemoryScope('weird')).toBe(false);
    expect(isWorkingMemoryScope(undefined)).toBe(false);
  });

  it('agent 스코프는 소유 페이즈(viewerPhaseId)만·subteam/global 공유', () => {
    const entries = [
      entry({ phaseId: 'p1', scope: 'agent', reusables: ['A:x'] }),
      entry({ phaseId: 'p2', scope: 'subteam', reusables: ['B:y'] }),
      entry({ phaseId: 'p3', scope: 'global', reusables: ['C:z'] }),
    ];
    // 뷰어 p1 — 자기 agent(p1) + subteam + global 다 봄.
    const v1 = formatWorkingMemoryForPrompt(entries, { viewerPhaseId: 'p1' });
    expect(v1).toContain('A:x'); expect(v1).toContain('B:y'); expect(v1).toContain('C:z');
    // 뷰어 p2 — 남의 agent-전용(p1)은 못 봄, subteam/global 은 봄.
    const v2 = formatWorkingMemoryForPrompt(entries, { viewerPhaseId: 'p2' });
    expect(v2).not.toContain('A:x'); expect(v2).toContain('B:y'); expect(v2).toContain('C:z');
    // viewerPhaseId 없으면 필터 없음(현행·비파괴).
    expect(formatWorkingMemoryForPrompt(entries, {})).toContain('A:x');
  });

  it('scope 없는 기존 엔트리는 subteam 취급(공유·비파괴)', () => {
    const entries = [entry({ phaseId: 'p1', reusables: ['legacy:x'] })]; // scope 미지정
    expect(formatWorkingMemoryForPrompt(entries, { viewerPhaseId: 'other' })).toContain('legacy:x');
  });
});
