import { describe, it, expect } from 'bun:test';
import type { MissionArc } from '../task-orchestrator/mission.js';
import {
  extractFileRefs, parsePreflightVerdict, preflightArc, preflightArcs,
  guardMirageFalsePositive, guardOverScopeFalsePositive,
  type ArcPreflightDeps, type ArcPhaseText,
} from './mission-arc-preflight.js';

const arc = (over: Partial<MissionArc> & { arcId: string }): MissionArc => ({
  name: over.arcId, intent: 'x', phaseIds: [], dependsOnArcs: [], acceptance: [], status: 'pending', ...over,
});

// judge 를 주입해 결정론 테스트(LLM 미호출). ground/fileExists 도 주입.
const deps = (over: Partial<ArcPreflightDeps> = {}): ArcPreflightDeps => ({
  ground: async () => ({ grounded: true, context: '관련 코드', files: ['src/x.ts'] }),
  readFiles: () => '### src/x.ts\ncode',
  fileExists: () => true,
  repoRoot: '/repo',
  ...over,
});

describe('extractFileRefs', () => {
  it('소스/문서 파일 경로를 추출한다', () => {
    const refs = extractFileRefs('수정: src/model-tier/embedding-tier-map.ts 와 docs/PLAN-x.md 참고');
    expect(refs).toContain('src/model-tier/embedding-tier-map.ts');
    expect(refs).toContain('docs/PLAN-x.md');
  });
  it('파일 참조 없으면 빈 배열', () => {
    expect(extractFileRefs('임베딩 유사도로 판정한다')).toEqual([]);
  });
});

describe('parsePreflightVerdict', () => {
  it('mirage 판정 파싱 + action 정합', () => {
    const v = parsePreflightVerdict('{"verdict":"mirage","reason":"지목 파일 무관","action":"descope"}');
    expect(v).toEqual({ verdict: 'mirage', reason: '지목 파일 무관', action: 'descope' });
  });
  it('founded 는 action 을 keep 으로 강제(허상 아닌데 descope 방지)', () => {
    const v = parsePreflightVerdict('{"verdict":"founded","reason":"ok","action":"descope"}');
    expect(v.action).toBe('keep');
  });
  it('파싱 실패 → 보수적 founded/keep', () => {
    const v = parsePreflightVerdict('그냥 텍스트');
    expect(v.verdict).toBe('founded');
    expect(v.action).toBe('keep');
  });
});

describe('guardMirageFalsePositive (구현 아크 mirage 오탐 가드·라이브 dce057)', () => {
  const mir = (reason: string) => ({ verdict: 'mirage' as const, reason, action: 'descope' as const });

  it('미구현 근거 mirage + 지목 파일 실재(missingFiles 0) → founded 강등', () => {
    // 라이브 재현: 아크2 "YouTube 흡수 흐름 구현" → "실제 코드가 확인되지 않음" 근거 mirage.
    const v = guardMirageFalsePositive(mir('grounding에서 해당하는 실제 코드가 확인되지 않음'), []);
    expect(v.verdict).toBe('founded');
    expect(v.action).toBe('keep');
    expect(v.reason).toContain('[오탐가드]');
  });

  it('missingFiles>0(잘못된 파일 지목) → mirage 유지(정당한 허상)', () => {
    const v = guardMirageFalsePositive(mir('아직 구현되지 않음'), ['src/nope.ts']);
    expect(v.verdict).toBe('mirage');
  });

  it('미구현 외 근거(없는 전제) → mirage 유지', () => {
    const v = guardMirageFalsePositive(mir('존재하지 않는 golden-set fixture 재사용 전제'), []);
    expect(v.verdict).toBe('mirage');
  });

  it('영문 미구현 근거도 강등', () => {
    const v = guardMirageFalsePositive(mir('the service does not exist yet, no matching code'), []);
    expect(v.verdict).toBe('founded');
  });

  it('(C) reason 이 "없다"고 지목한 full-path 파일이 실재 → founded 강등 (fileExists 교차검증·라이브 8cd731 arc0)', () => {
    // 라이브 재현: sol 이 "전제로 삼은 src/skills/tools/youtube-transcript.ts 없음" 으로 mirage 판정했으나 실재.
    const v = guardMirageFalsePositive(
      mir('전제로 삼은 src/skills/tools/youtube-transcript.ts 가 grounding 에 없음'),
      [],
      { fileExists: (f) => f === 'src/skills/tools/youtube-transcript.ts' },
    );
    expect(v.verdict).toBe('founded');
    expect(v.action).toBe('keep');
    expect(v.reason).toContain('실재');
  });

  it('(C) reason 지목 파일이 실제로 부재 → mirage 유지(정당·과교정 방지)', () => {
    const v = guardMirageFalsePositive(
      mir('src/nonexistent/foo.ts 전제가 잘못됨'),
      [],
      { fileExists: () => false },
    );
    expect(v.verdict).toBe('mirage');
  });

  it('founded/over_scope 는 손대지 않음(패스스루)', () => {
    const f = { verdict: 'founded' as const, reason: 'ok', action: 'keep' as const };
    expect(guardMirageFalsePositive(f, [])).toBe(f);
    const os = { verdict: 'over_scope' as const, reason: '이미 존재', action: 'narrow' as const };
    expect(guardMirageFalsePositive(os, [])).toBe(os);
  });
});

describe('guardOverScopeFalsePositive (over_scope 오탐 가드·라이브 bc37d7)', () => {
  const os = (reason: string) => ({ verdict: 'over_scope' as const, reason, action: 'narrow' as const });

  it('정합성/분해품질 근거 over_scope → founded 강등(정의 밖)', () => {
    // 라이브 재현: "페이즈가 구현 계약을 정의 안 함"(정합성) → over_scope 오분류.
    const v = guardOverScopeFalsePositive(os('페이즈 0~1은 조사만 하고 구현 계약을 정의하지 않는다'));
    expect(v.verdict).toBe('founded');
    expect(v.action).toBe('keep');
    expect(v.reason).toContain('[오탐가드]');
  });

  it('구현 아크 정상 크기("새로 만들 게 많다") → founded 강등', () => {
    const v = guardOverScopeFalsePositive(os('신규 digest 구현이 여러 파일에 걸쳐 광범위하다'));
    expect(v.verdict).toBe('founded');
  });

  it('중복 신호(이미 존재) → over_scope 유지(정당)', () => {
    const v = guardOverScopeFalsePositive(os('규칙기반 판정기가 이미 작동하는데 중복 신설'));
    expect(v.verdict).toBe('over_scope');
  });

  it('별도 미션급 대공사 신호 → over_scope 유지(정당)', () => {
    const v = guardOverScopeFalsePositive(os('성숙도 여러 단계에 걸친 별도 미션 여러 개급 대공사'));
    expect(v.verdict).toBe('over_scope');
  });

  it('founded/mirage 는 손대지 않음(패스스루)', () => {
    const f = { verdict: 'founded' as const, reason: 'ok', action: 'keep' as const };
    expect(guardOverScopeFalsePositive(f)).toBe(f);
    const m = { verdict: 'mirage' as const, reason: '잘못된 파일', action: 'descope' as const };
    expect(guardOverScopeFalsePositive(m)).toBe(m);
  });
});

describe('preflightArc', () => {
  const phases: ArcPhaseText[] = [
    { id: 'task:p1', title: '임베딩 supersede 판정기 구현', description: 'src/model-tier/embedding-tier-map.ts 수정, 기존 golden-set fixture 재사용' },
  ];

  it('허상 아크 감지 — judge 가 mirage 반환(잘못된 파일·없는 전제)', async () => {
    let judged = '';
    const v = await preflightArc(
      arc({ arcId: 'arc2', name: '임베딩 supersede', intent: '임베딩 유사도로 supersede 판정', phaseIds: ['task:p1'] }),
      phases,
      deps({
        // embedding-tier-map.ts 는 실재하지만 무관 / golden-set 은 없음 → judge 가 mirage.
        fileExists: (p) => p !== 'golden-set',
        judge: async (prompt) => { judged = prompt; return '{"verdict":"mirage","reason":"embedding-tier-map은 모델티어 config·supersede 무관","action":"descope"}'; },
      }),
    );
    expect(v.verdict).toBe('mirage');
    expect(v.action).toBe('descope');
    // 프롬프트에 지목 파일·의도가 실림.
    expect(judged).toContain('embedding-tier-map.ts');
  });

  it('(B) 실재 지목 파일이 프롬프트 "실재 확인됨" 섹션에 실린다(컨텍스트 유실 수복)', async () => {
    let judged = '';
    await preflightArc(
      arc({ arcId: 'b', name: 'youtube 흡수', intent: 'src/skills/tools/youtube-transcript.ts 재사용', phaseIds: ['task:p1'] }),
      [{ id: 'task:p1', title: 'x', description: 'src/skills/tools/youtube-transcript.ts 위에 구현' }],
      deps({
        fileExists: (p) => p === 'src/skills/tools/youtube-transcript.ts',
        judge: async (prompt) => { judged = prompt; return '{"verdict":"founded","reason":"ok","action":"keep"}'; },
      }),
    );
    expect(judged).toContain('실재 확인됨');
    expect(judged).toContain('src/skills/tools/youtube-transcript.ts');
  });

  it('founded 아크는 통과(keep)', async () => {
    const v = await preflightArc(
      arc({ arcId: 'arc1', name: '위키 갱신', intent: '위키 증분 갱신', phaseIds: ['task:p1'] }),
      phases,
      deps({ judge: async () => '{"verdict":"founded","reason":"doc-curate 위에 구현 가능","action":"keep"}' }),
    );
    expect(v.verdict).toBe('founded');
    expect(v.action).toBe('keep');
  });

  it('구현 아크 미구현-근거 mirage → 가드가 founded 강등(오탐 차단·라이브 dce057 통합)', async () => {
    // judge(비결정)가 구현 아크를 "실제 코드 확인 안 됨"(=미구현)으로 mirage 오판(프롬프트 line 86 위반).
    // 지목 파일은 모두 실재(missingFiles=0) → guardMirageFalsePositive 가 founded 강등. preflightArc
    // 통합 경로(judge→parse→guard→verdict) 검증 — 라이브는 judge 흔들림에 의존해 결정론 재현이 필요.
    const v = await preflightArc(
      arc({ arcId: 'impl', name: 'YouTube 흡수 흐름 구현', intent: 'runYoutubeAbsorb 서비스 구현·배선', phaseIds: ['task:p1'] }),
      phases,
      deps({
        fileExists: () => true, // 지목 파일 모두 실재 → missingFiles=0
        judge: async () => '{"verdict":"mirage","reason":"grounding에서 해당하는 실제 코드가 확인되지 않음","action":"descope"}',
      }),
    );
    expect(v.verdict).toBe('founded'); // 가드가 오탐 강등
    expect(v.action).toBe('keep');
    expect(v.reason).toContain('[오탐가드]');
  });

  it('over_scope 감지 — 규칙기반 이미 존재', async () => {
    const v = await preflightArc(
      arc({ arcId: 'arc2', name: 'supersede', intent: '의미 supersede', phaseIds: ['task:p1'] }),
      phases,
      deps({ judge: async () => '{"verdict":"over_scope","reason":"규칙기반 doc-curation.ts 이미 작동·의미판정은 별도 미션급","action":"narrow"}' }),
    );
    expect(v.verdict).toBe('over_scope'); // 중복+별도미션급 신호 → 가드 유지(정당)
    expect(v.action).toBe('narrow');
  });

  it('구현 아크 정합성/크기-근거 over_scope → 가드가 founded 강등(오탐 차단·통합)', async () => {
    // judge 가 "새로 만들 게 많다"(구현 아크 정상 크기)를 over_scope 로 오분류 — 중복·별도미션급 신호 없음.
    const v = await preflightArc(
      arc({ arcId: 'os', name: 'YouTube digest 구현', intent: 'digest 유닛 신규 구현', phaseIds: ['task:p1'] }),
      phases,
      deps({ judge: async () => '{"verdict":"over_scope","reason":"신규 구현이 여러 파일에 걸쳐 광범위하다","action":"narrow"}' }),
    );
    expect(v.verdict).toBe('founded'); // 가드 강등(정의 밖 근거)
    expect(v.action).toBe('keep');
    expect(v.reason).toContain('[오탐가드]');
  });

  it('fail-soft — judge 예외는 founded/keep(자동 차단 안 함)', async () => {
    const v = await preflightArc(
      arc({ arcId: 'arc1', name: 'x', phaseIds: ['task:p1'] }),
      phases,
      deps({ judge: async () => { throw new Error('LLM down'); } }),
    );
    expect(v.verdict).toBe('founded');
    expect(v.action).toBe('keep');
  });

  it('judge 미주입(test) → founded 폴백', async () => {
    const v = await preflightArc(
      arc({ arcId: 'arc1', name: 'x', phaseIds: ['task:p1'] }),
      phases,
      deps({ judge: undefined }),
    );
    expect(v.verdict).toBe('founded');
  });
});

describe('preflightArcs', () => {
  it('전 아크 판정 배열 반환(선언 순)', async () => {
    const arcs = [
      arc({ arcId: 'arc1', name: 'A', phaseIds: ['task:p1'] }),
      arc({ arcId: 'arc2', name: 'B', phaseIds: ['task:p2'] }),
    ];
    const phases: ArcPhaseText[] = [{ id: 'task:p1', title: 'A' }, { id: 'task:p2', title: 'B' }];
    const verdicts = await preflightArcs(arcs, phases, deps({
      judge: async (p) => p.includes('이름: B') ? '{"verdict":"mirage","reason":"x","action":"descope"}' : '{"verdict":"founded","reason":"ok","action":"keep"}',
    }));
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0]!.verdict).toBe('founded');
    expect(verdicts[1]!.verdict).toBe('mirage');
  });
});
