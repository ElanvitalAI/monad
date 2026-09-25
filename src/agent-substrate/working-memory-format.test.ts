// 공용 working-memory 포맷(C4 승격) — 순수 파싱/포맷/dedup 코어 검증.
import { test, expect, describe } from 'bun:test';
import {
  parseWorkingMemorySignals,
  stripWorkingMemoryMarker,
  parseWorkingMemoryJsonl,
  dedupWorkingMemory,
  formatWorkingMemoryForPrompt,
  formatPremiseMemo,
  parseDeviation,
  normList,
  type WorkingMemoryEntry,
} from './working-memory-format.js';

const entry = (o: Partial<WorkingMemoryEntry> = {}): WorkingMemoryEntry => ({
  phaseId: 'p1', phaseTitle: '조사', kind: 'investigation', at: '2026-07-20T00:00:00Z',
  summary: 's', reusables: [], decisions: [], artifacts: [], ...o,
});

describe('working-memory-format — 순수 코어', () => {
  test('parseWorkingMemorySignals — 마커 JSON 추출', () => {
    const r = parseWorkingMemorySignals('작업했음\n[WORKING-MEMORY]\n{"summary":"요약","reusables":["a:b"],"decisions":["d1"]}');
    expect(r.summary).toBe('요약');
    expect(r.reusables).toEqual(['a:b']);
    expect(r.decisions).toEqual(['d1']);
  });
  test('parseWorkingMemorySignals — 마커 없으면 fallback(응답 앞부분)', () => {
    const r = parseWorkingMemorySignals('그냥 텍스트');
    expect(r.summary).toBe('그냥 텍스트');
    expect(r.reusables).toEqual([]);
  });
  test('stripWorkingMemoryMarker — 마커+JSON 제거', () => {
    expect(stripWorkingMemoryMarker('보고\n[WORKING-MEMORY]\n{"summary":"x"}')).toBe('보고');
    expect(stripWorkingMemoryMarker('마커 없음')).toBe('마커 없음');
  });
  test('parseDeviation — kind/note 검증·미상 other', () => {
    expect(parseDeviation({ kind: 'scope_reduction', note: '축소' })).toEqual({ kind: 'scope_reduction', note: '축소' });
    expect(parseDeviation({ kind: '몰라', note: 'x' })?.kind).toBe('other');
    expect(parseDeviation({ note: '' })).toBeUndefined();
  });
  test('parseWorkingMemoryJsonl — jsonl 파싱·깨진 줄 skip', () => {
    const out = parseWorkingMemoryJsonl('{"phaseId":"p1","summary":"a"}\n깨짐\n{"phaseId":"p2","summary":"b"}');
    expect(out).toHaveLength(2);
    expect(out[1]!.phaseId).toBe('p2');
  });
  test('dedupWorkingMemory — 같은 phaseId 최신만(latest-wins)', () => {
    const out = dedupWorkingMemory([entry({ summary: 'old' }), entry({ summary: 'new' })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.summary).toBe('new');
  });
  test('formatWorkingMemoryForPrompt — 재사용 경계 주입·빈 배열 ""', () => {
    expect(formatWorkingMemoryForPrompt([])).toBe('');
    const block = formatWorkingMemoryForPrompt([entry({ reusables: ['mod:fn'], decisions: ['d'] })]);
    expect(block).toContain('재사용');
    expect(block).toContain('mod:fn');
  });
  test('★ P1.5 — SKILL.md 경로는 코드 export 와 분리·"Read 참조" 섹션', () => {
    const block = formatWorkingMemoryForPrompt([entry({
      reusables: ['mod:fn', '/Users/x/.claude/skills/yt-vault/SKILL.md'],
    })]);
    expect(block).toContain('mod:fn');
    // SKILL.md 경로는 별도 '관련 스킬' 섹션(Read 참조)으로
    expect(block).toContain('관련 스킬');
    expect(block).toContain('Read');
    expect(block).toContain('SKILL.md');
    // 코드 export("재구현 금지") 섹션엔 SKILL.md 가 안 섞임
    const codeSection = block.split('관련 스킬')[0]!;
    expect(codeSection).not.toContain('SKILL.md');
  });
  test('★ L3 — skill 계약 팩트(decisions [skill:])는 내용으로 렌더·일반 decision 과 분리', () => {
    const block = formatWorkingMemoryForPrompt([entry({
      reusables: ['/Users/x/.claude/skills/yt-vault/SKILL.md'],
      decisions: ['[skill:yt-vault] YouTube 지식 창고 — absorb 로 흡수', '실제 페이즈 결정 A'],
    })]);
    // 팩트(계약 내용)가 '관련 스킬' 섹션에 내용째 뜸(Read 없이 보유)
    expect(block).toContain('[skill:yt-vault]');
    expect(block).toContain('absorb 로 흡수');
    // 일반 결정은 '이전 페이즈의 결정' 섹션·skill 팩트는 거기 안 섞임
    const decisionSection = block.split('이전 페이즈의 결정')[1] ?? '';
    expect(decisionSection).toContain('실제 페이즈 결정 A');
    expect(decisionSection).not.toContain('[skill:');
  });
  test('★ L4 — 코드 export 심볼 팩트([code:])는 재사용 심볼 섹션에·환각 금지 프레이밍', () => {
    const block = formatWorkingMemoryForPrompt([entry({
      decisions: ['[code:src/autopilot/absorb-flow.ts] runAbsorb, AbsorbResult', '실제 결정 B'],
    })]);
    expect(block).toContain('코드 export 심볼');
    expect(block).toContain('runAbsorb');
    expect(block).toContain('추측/환각 말고'); // 환각 금지 프레이밍
    // 일반 결정과 분리
    const decisionSection = block.split('이전 페이즈의 결정')[1] ?? '';
    expect(decisionSection).toContain('실제 결정 B');
    expect(decisionSection).not.toContain('[code:');
  });
  test('★ P2 — 기억·자기이력·문서 팩트([memory:/[self:/[doc])는 참조 지식 섹션·재사용/결정과 분리', () => {
    const block = formatWorkingMemoryForPrompt([entry({
      decisions: [
        '[memory:project] 세션 패브릭 아크: 영속바인딩·포크 완주',
        '[self:impl] runGoalLoop 증거게이트 배선',
        '[doc] HANDOFF-session-fabric 요약',
        '실제 결정 C',
      ],
    })]);
    // 참조 지식 섹션에 내용째 렌더(사실 배경)
    expect(block).toContain('참조 지식');
    expect(block).toContain('[memory:project]');
    expect(block).toContain('[self:impl]');
    expect(block).toContain('[doc]');
    expect(block).toContain('파일 실존'); // 재사용 경계 아님 프레이밍
    // 일반 결정 섹션엔 corpus 팩트가 안 섞임(prefix 로 분리)
    const decisionSection = block.split('이전 페이즈의 결정')[1] ?? '';
    expect(decisionSection).toContain('실제 결정 C');
    expect(decisionSection).not.toContain('[memory:');
    expect(decisionSection).not.toContain('[self:');
    expect(decisionSection).not.toContain('[doc]');
  });
  test('★ mirage carry — preflight 진단([premise:])은 친절 교정 메모로 최상단 노출·일반 결정과 분리(대표 2026-07-21)', () => {
    const block = formatWorkingMemoryForPrompt([entry({
      decisions: [
        '[premise:mirage] 아크 "채팅 서피스 배선": src/chat/index.ts 는 URL 핸들러가 아니라 대시보드 인라인 Grok 모듈',
        '아크 코어: 3페이즈',
      ],
    })]);
    // 교정 메모 섹션에 진단이 내용째 렌더(기계 태그 [premise:...]는 가독 위해 벗겨냄)
    expect(block).toContain('아크 전제 교정 메모');
    expect(block).not.toContain('[premise:mirage]'); // 태그 제거 — 친절 메모
    expect(block).toContain('아크 "채팅 서피스 배선"'); // 아크명 보존
    expect(block).toContain('URL 핸들러가 아니'); // reason 보존
    expect(block).toContain('재확인'); // 친절 actionable 교정 지시
    expect(block).toContain('올바른 실제 경로'); // 교정 방향
    // ★ 최우선 노출 — premise 메모가 재사용/일반 결정 섹션보다 앞에.
    expect(block.indexOf('아크 전제 교정 메모')).toBeLessThan(block.indexOf('이전 페이즈 요약'));
    // 일반 결정 섹션엔 premise 팩트가 안 섞임(prefix 로 분리·상단에서 이미 렌더)
    const decisionSection = block.split('이전 페이즈의 결정')[1] ?? '';
    expect(decisionSection).toContain('아크 코어: 3페이즈');
    expect(decisionSection).not.toContain('[premise:');
  });
  test('★ formatPremiseMemo — 태그 벗기고 친절 actionable 교정 지시로 감쌈(순수)', () => {
    const memo = formatPremiseMemo('[premise:mirage] 아크 "X": foo.ts 는 진입점이 아니다');
    expect(memo).not.toContain('[premise:');
    expect(memo).toContain('아크 "X": foo.ts 는 진입점이 아니다');
    expect(memo).toContain('재확인');
    expect(memo).toContain('올바른 실제 경로');
    // 태그 없는 원문도 안전(폴백)
    expect(formatPremiseMemo('원문 진단').startsWith('원문 진단')).toBe(true);
  });
  test('normList — 트림·중복제거·상한', () => {
    expect(normList(['a', 'a', ' b '])).toEqual(['a', 'b']);
    expect(normList('x')).toEqual(['x']);
    expect(normList(null)).toEqual([]);
  });
});
