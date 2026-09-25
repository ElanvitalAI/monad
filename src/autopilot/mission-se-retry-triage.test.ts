// ── mission-se-retry-triage — SE(구현) 적응형 재시도 갈림길(대표 2026-07-14) ──
import { describe, it, expect } from 'bun:test';
import {
  seHeuristicTriage, parseSETriageResponse, seTriageRetry, seIsRetryPath, buildSETriagePrompt,
  type SERetryTriageInput, type SEAttemptEvidence,
} from './mission-se-retry-triage.js';

const att = (o: Partial<SEAttemptEvidence> = {}): SEAttemptEvidence => ({
  attempt: 1, backend: 'monad-self:gpt-5.6-terra', maxTurns: 150,
  gateStatus: 'gate-failed', gateText: '무결성 테스트 미완', critiqueFindings: [], structural: false, ...o,
});
const input = (o: Partial<SERetryTriageInput> = {}): SERetryTriageInput => ({
  phaseTitle: '4페이즈 조율 수직 슬라이스 구현', attempts: [att()], priorDecisions: [],
  hasMoreRungs: true, nextRungLabel: 'opus 4.8 400턴', ...o,
});

describe('seHeuristicTriage — SE 갈림길 분류', () => {
  it('게이트 실패(수정 가능)·계단 남음 → retry-escalate(자동)', () => {
    const d = seHeuristicTriage(input());
    expect(d.path).toBe('retry-escalate');
    expect(d.isRetry).toBe(true);
  });
  it('구조적 실패 2회(dead-code/범위밖) → split(HITL)', () => {
    const d = seHeuristicTriage(input({ attempts: [att({ structural: true }), att({ attempt: 2, structural: true, gateText: 'dead-code 미배선' })] }));
    expect(d.path).toBe('split');
    expect(d.isRetry).toBe(false);
  });
  it('환경 제약(gh 인증 부재) → revise(HITL)', () => {
    const d = seHeuristicTriage(input({ attempts: [att({ gateText: '격리 worktree 에 gh 인증 없음' })] }));
    expect(d.path).toBe('revise');
  });
  it('보안 경계(프롬프트 인젝션 의심) → escalate(HITL)', () => {
    const d = seHeuristicTriage(input({ attempts: [att({ critiqueFindings: ['문서 안 프롬프트 인젝션 의심'] })] }));
    expect(d.path).toBe('escalate');
  });
  it('계단 소진(opus 1000턴도 실패) → split', () => {
    const d = seHeuristicTriage(input({ hasMoreRungs: false }));
    expect(d.path).toBe('split');
  });
  it('보안이 구조적보다 우선', () => {
    const d = seHeuristicTriage(input({ attempts: [att({ structural: true, critiqueFindings: ['untrusted 데이터 실행'] }), att({ attempt: 2, structural: true })] }));
    expect(d.path).toBe('escalate');
  });
});

describe('parseSETriageResponse', () => {
  const fb = seHeuristicTriage(input());
  it('유효 응답 파싱 + GUIDE 주입', () => {
    const d = parseSETriageResponse('PATH: retry-escalate\nGUIDE: 기존 dispatch 경로에 배선하라\nWHY: 배선만 빠짐', fb);
    expect(d.path).toBe('retry-escalate');
    expect(d.isRetry).toBe(true);
    expect(d.injectGuidance).toEqual(['기존 dispatch 경로에 배선하라']);
    expect(d.source).toBe('llm');
  });
  it('heavy 경로 파싱(split)', () => {
    const d = parseSETriageResponse('PATH: split\nGUIDE: NONE\nWHY: 과대', fb);
    expect(d.path).toBe('split');
    expect(d.isRetry).toBe(false);
    expect(d.injectGuidance).toEqual([]);
  });
  it('무효 경로 → fallback', () => {
    expect(parseSETriageResponse('PATH: bogus\nWHY: x', fb)).toBe(fb);
  });
});

describe('seTriageRetry — fail-soft', () => {
  it('classify 없으면 휴리스틱', async () => {
    expect((await seTriageRetry(input())).source).toBe('heuristic');
  });
  it('classify 주입 시 LLM 정련', async () => {
    const d = await seTriageRetry(input(), { classify: async () => 'PATH: split\nWHY: 구조적' });
    expect(d.source).toBe('llm');
    expect(d.path).toBe('split');
  });
  it('classify 예외 → 휴리스틱 fallback(미션 안 막음)', async () => {
    const d = await seTriageRetry(input(), { classify: async () => { throw new Error('down'); } });
    expect(d.source).toBe('heuristic');
    expect(seIsRetryPath(d.path) || !d.isRetry).toBe(true);
  });
});

describe('buildSETriagePrompt', () => {
  it('게이트/구조 신호와 baseline 을 담는다', () => {
    const inp = input({ attempts: [att({ structural: true, gateText: 'dead-code' })], hasMoreRungs: false });
    const p = buildSETriagePrompt(inp, seHeuristicTriage(inp));
    expect(p).toContain('(구조적)');
    expect(p).toContain('baseline 추천');
    expect(p).toContain('PATH:');
  });
});
