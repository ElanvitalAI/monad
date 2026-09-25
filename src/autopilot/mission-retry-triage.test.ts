// ── mission-retry-triage — 적응형 재시도 갈림길 분류(대표 2026-07-13) ──
import { describe, it, expect } from 'bun:test';
import {
  heuristicTriage, parseTriageResponse, triageRetry, isRetryPath, buildTriagePrompt,
  type RetryTriageInput, type RetryAttemptEvidence,
} from './mission-retry-triage.js';
import { checkArtifactExistence } from './mission-artifact-discipline.js';

const attempt = (o: Partial<RetryAttemptEvidence> = {}): RetryAttemptEvidence => ({
  attempt: 1, budget: 128000, failReason: 'budget', verdictMissing: false,
  textLength: 3000, textTail: '...', artifacts: [{ path: '.artifacts/x.json', exists: false, sizeBytes: 0 }], ...o,
});
const input = (o: Partial<RetryTriageInput> = {}): RetryTriageInput => ({
  phaseTitle: '급락 심층 조사', requiredArtifacts: ['.artifacts/x.json'],
  attempts: [attempt()], priorDecisions: [], nextBudgetDefault: 256000, ...o,
});

describe('checkArtifactExistence', () => {
  it('statFn DI 로 존재/크기를 반영한다', () => {
    const r = checkArtifactExistence(['.artifacts/a.json', '.artifacts/b.json'], {
      cwd: '/repo', statFn: (abs) => abs.endsWith('a.json') ? { size: 42 } : null,
    });
    expect(r).toEqual([
      { path: '.artifacts/a.json', exists: true, sizeBytes: 42 },
      { path: '.artifacts/b.json', exists: false, sizeBytes: 0 },
    ]);
  });
  it('절대경로는 그대로, 상대경로는 cwd 기준 해석', () => {
    let seen = '';
    checkArtifactExistence(['/abs/x.json'], { cwd: '/repo', statFn: (a) => { seen = a; return null; } });
    expect(seen).toBe('/abs/x.json');
    checkArtifactExistence(['rel/y.json'], { cwd: '/repo', statFn: (a) => { seen = a; return null; } });
    expect(seen).toBe('/repo/rel/y.json');
  });
});

describe('heuristicTriage — 갈림길 분류', () => {
  it('★P2: 장황한 서술 + 산출물 0 = 규율 실패 → retry-discipline·예산 동일 유지', () => {
    const d = heuristicTriage(input({ attempts: [attempt({ budget: 512000, textLength: 8000 })] }));
    expect(d.path).toBe('retry-discipline');
    expect(d.isRetry).toBe(true);
    expect(d.nextBudget).toBe(512000); // 상향 아님 — 동일 유지
    expect(d.injectInstructions.join(' ')).toContain('저장');
  });
  it('산출물 0 + 서술도 적음 = 진짜 부족 → retry-budget·상향', () => {
    const d = heuristicTriage(input({ attempts: [attempt({ textLength: 200 })] }));
    expect(d.path).toBe('retry-budget');
    expect(d.nextBudget).toBe(256000); // nextBudgetDefault(상향)
  });
  it('부분 저장(size>0)·미충족 = 예산 상향해 완성 → retry-budget', () => {
    const d = heuristicTriage(input({ attempts: [attempt({ artifacts: [{ path: '.artifacts/x.json', exists: true, sizeBytes: 100 }] })] }));
    expect(d.path).toBe('retry-budget');
    expect(d.isRetry).toBe(true);
  });
  it('전제 부재(blocked) → revise(HITL)', () => {
    const d = heuristicTriage(input({ attempts: [attempt({ failReason: 'blocked' })] }));
    expect(d.path).toBe('revise');
    expect(d.isRetry).toBe(false);
  });
  it('재시도 2회 소진 → split(HITL)', () => {
    const d = heuristicTriage(input({ priorDecisions: ['retry-budget', 'retry-discipline'] }));
    expect(d.path).toBe('split');
    expect(d.isRetry).toBe(false);
  });
  it('규율 주입했는데도 또 미저장 → split(과대 의심·HITL)', () => {
    const d = heuristicTriage(input({ priorDecisions: ['retry-discipline'], attempts: [attempt({ textLength: 8000 })] }));
    expect(d.path).toBe('split');
    expect(d.isRetry).toBe(false);
  });
});

describe('parseTriageResponse', () => {
  const fb = heuristicTriage(input());
  it('유효 응답을 파싱하고 예산 배수를 적용한다(retry-budget=계단 상향)', () => {
    const d = parseTriageResponse('PATH: retry-budget\nBUDGET: 2.0\nINSTRUCT: NONE\nWHY: 진짜 부족', fb, 256000, 128000);
    expect(d.path).toBe('retry-budget');
    expect(d.nextBudget).toBe(512000); // nextBudgetDefault*2
    expect(d.source).toBe('llm');
    expect(d.injectInstructions).toEqual([]);
  });
  it('★규율 경로는 예산을 hold(증액 금지) + INSTRUCT 주입', () => {
    // holdBudget=256k(직전 실패 예산). BUDGET 2.0 이 와도 규율은 hold(min(mult,1)=1) → 256k 유지.
    const d = parseTriageResponse('PATH: retry-discipline\nBUDGET: 2.0\nINSTRUCT: 저장 먼저 하라\nWHY: 장황', fb, 512000, 256000);
    expect(d.path).toBe('retry-discipline');
    expect(d.nextBudget).toBe(256000); // 계단(512k) 아니라 hold(256k)
    expect(d.injectInstructions).toEqual(['저장 먼저 하라']);
  });
  it('무효 경로는 fallback 반환', () => {
    const d = parseTriageResponse('PATH: nonsense\nWHY: x', fb, 256000, 128000);
    expect(d).toBe(fb);
  });
  it('예산 배수를 [0.5, 8] 로 클램프(retry-budget)', () => {
    expect(parseTriageResponse('PATH: retry-budget\nBUDGET: 99', fb, 100000, 100000).nextBudget).toBe(800000);
    expect(parseTriageResponse('PATH: retry-budget\nBUDGET: 0.1', fb, 100000, 100000).nextBudget).toBe(50000);
  });
  it('heavy 경로는 nextBudget=default·isRetry=false', () => {
    const d = parseTriageResponse('PATH: split\nWHY: 과대', fb, 256000, 128000);
    expect(d.isRetry).toBe(false);
    expect(d.nextBudget).toBe(256000);
  });
});

describe('triageRetry — fail-soft', () => {
  it('classify 없으면 결정론 휴리스틱', async () => {
    const d = await triageRetry(input());
    expect(d.source).toBe('heuristic');
  });
  it('classify 주입 시 LLM 정련', async () => {
    const d = await triageRetry(input(), { classify: async () => 'PATH: split\nWHY: 과대 판단' });
    expect(d.source).toBe('llm');
    expect(d.path).toBe('split');
  });
  it('classify 예외 → 휴리스틱 fallback(미션 안 막음)', async () => {
    const d = await triageRetry(input(), { classify: async () => { throw new Error('llm down'); } });
    expect(d.source).toBe('heuristic');
    expect(isRetryPath(d.path) || !d.isRetry).toBe(true);
  });
});

describe('buildTriagePrompt', () => {
  it('산출물 존재 사실과 baseline 을 프롬프트에 담는다', () => {
    const inp = input({ attempts: [attempt({ textLength: 8000 })] });
    const bl = heuristicTriage(inp);
    const p = buildTriagePrompt(inp, bl);
    expect(p).toContain('.artifacts/x.json=없음');
    expect(p).toContain('baseline 추천');
    expect(p).toContain('PATH:');
  });
});
