import { describe, it, expect } from 'bun:test';
import { openAutopilotMissionsDb, createMission } from './mission-registry.js';
import {
  goalSimilarity, findSimilarMissions, parseGoalShapeVerdict, assessGoalShape, formatRedesignProposal,
} from './mission-redesign.js';

const AT = new Date('2026-07-14T00:00:00Z');
const noGround = async () => ({ grounded: false, context: '', files: [] as string[] });

describe('A6-a goalSimilarity / findSimilarMissions', () => {
  it('goalSimilarity Jaccard — 겹침 클수록 높음', () => {
    expect(goalSimilarity('삼성전자 반도체 매력도 분석', '삼성전자 반도체 분석')).toBeGreaterThan(0.4);
    expect(goalSimilarity('PWA 채팅 스트리밍', '투자 포트폴리오 리밸런싱')).toBe(0);
  });

  it('findSimilarMissions 는 자기 제외·임계 이상만', () => {
    const db = openAutopilotMissionsDb(':memory:');
    const a = createMission(db, { goal: '로컬 LLM 야간 위키 정련 배선', source: 'manual', now: AT, slug: 'wiki-a' });
    createMission(db, { goal: '로컬 LLM 야간 위키 정련 재실행', source: 'manual', now: AT, slug: 'wiki-b' });
    createMission(db, { goal: '완전 무관한 투자 매매 루프', source: 'manual', now: AT, slug: 'trade' });
    const sim = findSimilarMissions(db, a.goal, a.id);
    expect(sim.map((s) => s.goal)).toContain('로컬 LLM 야간 위키 정련 재실행');
    expect(sim.some((s) => s.id === a.id)).toBe(false);
    expect(sim.some((s) => s.goal.includes('투자 매매'))).toBe(false);
  });
});

describe('A6-a parseGoalShapeVerdict', () => {
  it('bundle/mirage/over_scope 인식', () => {
    expect(parseGoalShapeVerdict('{"verdict":"bundle","reason":"수집+판정+UI","suggestion":"3미션"}').verdict).toBe('bundle');
    expect(parseGoalShapeVerdict('{"verdict":"mirage","reason":"없는 파일","suggestion":"전제 수정"}').verdict).toBe('mirage');
    expect(parseGoalShapeVerdict('{"verdict":"over_scope","reason":"과대","suggestion":"성숙도"}').verdict).toBe('over_scope');
  });

  it('founded 는 suggestion 비움·파싱 실패는 보수적 founded', () => {
    expect(parseGoalShapeVerdict('{"verdict":"founded","reason":"ok","suggestion":"무시됨"}').suggestion).toBe('');
    expect(parseGoalShapeVerdict('그냥 텍스트').verdict).toBe('founded');
    expect(parseGoalShapeVerdict('{"verdict":"weird"}').verdict).toBe('founded');
  });
});

describe('A6-a assessGoalShape (fail-soft·judge 주입)', () => {
  it('judge 주입 bundle → 판정 반환', async () => {
    const v = await assessGoalShape('수집+판정+UI+배포를 한 골에', {}, {
      ground: noGround,
      judge: async () => '{"verdict":"bundle","reason":"이질 4종","suggestion":"미션 분리"}',
    });
    expect(v.verdict).toBe('bundle');
    expect(v.suggestion).toBe('미션 분리');
  });

  it('프롬프트에 이름-낚임 경계 포함(redesign↔preflight 모순 방지·대표 2026-07-20)', async () => {
    let prompt = '';
    await assessGoalShape('youtube absorb 파이프라인 구축', {}, {
      ground: noGround,
      judge: async (p) => { prompt = p; return '{"verdict":"founded","reason":"ok","suggestion":""}'; },
    });
    // 골 키워드로 기존 자산 재사용을 단정하지 말라는 규칙 + absorb-flow 반례가 프롬프트에 실린다.
    expect(prompt).toContain('재사용');
    expect(prompt).toContain('absorb-flow');
    expect(prompt).toMatch(/이름.*매칭|목적.*다르|실제 목적/);
  });

  it('judge 오류 → fail-soft founded', async () => {
    const v = await assessGoalShape('골', {}, { ground: noGround, judge: async () => { throw new Error('llm down'); } });
    expect(v.verdict).toBe('founded');
  });

  it('judge 미주입(test) → 보수적 founded', async () => {
    const v = await assessGoalShape('골', {}, { ground: noGround });
    expect(v.verdict).toBe('founded');
  });
});

describe('A6-a formatRedesignProposal', () => {
  it('founded 는 빈 문자열', () => {
    expect(formatRedesignProposal({ verdict: 'founded', reason: 'ok', suggestion: '' })).toBe('');
  });

  it('bundle 은 역제안·유사 미션 포함', () => {
    const s = formatRedesignProposal(
      { verdict: 'bundle', reason: '이질 다발', suggestion: '[미션 A][미션 B]' },
      [{ id: 'apm_x_1', goal: 'g', status: 'done' }],
    );
    expect(s).toContain('리디자인 역제안');
    expect(s).toContain('[미션 A][미션 B]');
    expect(s).toContain('apm_x_1');
  });
});
