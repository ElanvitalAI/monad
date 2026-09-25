// 🚨 `JDG-T58` 후반부 — 리뷰 인용 경로 «관측 배선» 회귀.
//
// ⛔ 왜 «별도 파일»인가: orchestrator.test.ts 에는 runSelfImplement 를 돌리는 회귀가 누적되어
//   한 파일에서 자원을 다투면 «다른» 테스트가 자기 타임아웃(5s)에 걸린다(2026-08-19 실측).
//   ⇒ 이 회귀는 «배선»을 물어야 하므로 실물 런이 필요하고, 그래서 격리한다.
import { describe, test, expect } from 'bun:test';
import { debug } from '../debug/log.js';
import { buildRefutationGuidance, runSelfImplement } from './orchestrator.js';
import { FOUND_CITED_PATH_REFUTATION_QUOTE, MISSING_CITED_PATH_REFUTATION_QUOTE, stableMustFixId } from './reflect-mustfix.js';
import { seams } from './test-seams.js';

describe('리뷰 인용 경로 관측 «배선» (JDG-T58 후반부)', () => {
  // 🚨 이 회귀가 막는 것: observeCitedPathFacts 호출 · `review-cited-paths` 관측 · reflectMustFix 전달을
  //   «지우는» 것. ⛔ 순수 함수(reflect-mustfix) 테스트만으론 배선을 지워도 초록이다(`MEAS-T83`).
  //   📍 실물(2026-08-19 · 🅢 제보): 분해기가 «없는 파일»을 요구하고 리뷰가 그 허구를 수용 조건으로
  //     삼아 UNCONVERGEABLE 을 냈다. 자식이 그 사실을 «볼 수 있어야» 스스로 반박한다.
  test('인용 경로 사실이 관측·reflect·rework 프롬프트로 «흐른다» — 그리고 네 값을 따로 센다', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const originalLog = debug.log;
    (debug as { log: typeof debug.log }).log = ((_category, event, data) => {
      events.push({ event, data: data as Record<string, unknown> });
    }) as typeof debug.log;
    const reflected: Array<readonly { path: string; existence: string }[]> = [];
    const features: string[] = [];   // ⭐ rework 자식에게 «실제로» 간 프롬프트가 여기 쌓인다
    const finding = 'Review `src/llm/request-builder.ts` and `buildRequest`.';
    try {
      await runSelfImplement({
        feature: 'cited path wiring probe',
        maxReworkRounds: 1,
        seams: seams({
          features,
          reviewDiff: async () => features.length === 1
            ? { verdict: 'fail' as const, mustFix: [finding], shouldFix: [], summary: 'path review', reviewed: true }
            : { verdict: 'pass' as const, mustFix: [], shouldFix: [], summary: 'done', reviewed: true },
          // ⭐ 주입값 — 이 회귀는 «판정»이 아니라 «흐름»을 문다(판정은 reflect-mustfix 테스트가 문다)
          observeCitedPathFacts: (mustFix) => mustFix.length ? [
            { findingId: stableMustFixId(mustFix[0]!), path: 'src/llm/request-builder.ts', existence: 'missing' as const },
            { findingId: stableMustFixId(mustFix[0]!), path: 'buildRequest', existence: 'ambiguous' as const },
            { findingId: stableMustFixId(mustFix[0]!), path: 'bin/tool', existence: 'unknown' as const },
          ] : [],
          reflectMustFix: async (input) => {
            reflected.push(input.citedPathFacts ?? []);
            return { accepted: input.mustFix, rejected: [] };
          },
        }),
      });
    } finally {
      (debug as { log: typeof debug.log }).log = originalLog;
    }
    const observation = events.find((entry) => entry.event === 'review-cited-paths')?.data;
    // ⛔ 관측이 «났는지»부터 본다 — 안 났으면 배선이 끊긴 것이고 아래 단언은 무의미하다
    expect(observation).toBeDefined();
    // 🔑 허구 경로(missing) · 함수 이름(ambiguous) · 확인 실패(unknown) 가 «섞이지 않는다»
    expect(observation).toMatchObject({ missingCount: 1, ambiguousCount: 1, unknownCount: 1 });
    // ⭐ 그리고 그 사실이 reflect 로 «흘러간다» — 자식이 스스로 반박할 재료다
    expect(reflected.some((facts) => facts.some((fact) => fact.path === 'src/llm/request-builder.ts'))).toBe(true);
    // ⛔⭐ 그리고 «rework 자식의 프롬프트»에 실제로 들어간다 — 무인 리뷰 should-fix(2026-08-19):
    //   테스트 이름이 「프롬프트까지」라 말하면서 단언이 거기 없으면 ***그 테스트가 거짓을 말한다.***
    const reworkPrompt = features.at(-1) ?? '';
    expect(reworkPrompt).toContain('[리뷰 인용 경로 관측]');
    expect(reworkPrompt).toContain('src/llm/request-builder.ts: missing');
    expect(reworkPrompt).toContain('buildRequest: ambiguous');
  });

  // ⛔⭐⭐ 리뷰 should-fix — 위 회귀는 사실이 «흐르는» 것까지만 문다. 새 회부 갈래가 «실제 런»에서
  //   자격을 얻으려면 그 사실에 «라운드»가 붙어 파서까지 닿아야 한다. 그 배선이 끊기면
  //   자격 집합이 «항상 비어» 이 기능은 조용히 죽는다 — 순수 함수 시험은 그것을 못 잡는다.
  test('새 회부 갈래가 «실제 런»에서 자격을 얻는다 — 라운드가 파서까지 닿는다', async () => {
    const ledger: Array<{ event: string; data: Record<string, unknown> }> = [];
    const features: string[] = [];
    const finding = 'Fix `src/nowhere/ghost.ts` — it mishandles input.';
    const findingId = stableMustFixId(finding);
    await runSelfImplement({
      feature: 'missing cited path escalation wiring',
      maxReworkRounds: 2,
      seams: seams({
        features,
        writeRunLedger: (entry) => { ledger.push(entry as { event: string; data: Record<string, unknown> }); },
        // ⛔ 리뷰가 «계속» 같은 지적을 낸다 — 회부는 그때 일어난다(통과하면 그 경로에 안 닿는다)
        reviewDiff: async () => ({ verdict: 'fail' as const, mustFix: [finding], shouldFix: [], summary: 'ghost review', reviewed: true }),
        // ⭐ 라운드를 «붙여» 낸다 — 실제 관측기가 하는 일이다
        // ⭐ 오케스트레이터가 «건네준» 라운드를 그대로 찍는다 — 실제 관측기가 하는 일이고,
        //   여기에 상수를 박으면 이 시험이 배선이 아니라 «자기 상수»를 재게 된다.
        observeCitedPathFacts: (mustFix, _cwd, round) => mustFix.length
          ? [{ findingId: stableMustFixId(mustFix[0]!), path: 'src/nowhere/ghost.ts', existence: 'missing' as const, ...(round === undefined ? {} : { round }) }]
          : [],
        // 자식이 «골 줄이 아니라» 그 사실을 근거로 회부한다
        implement: async () => ({ ok: true, summary: `REFUTE [${findingId}] ${JSON.stringify(MISSING_CITED_PATH_REFUTATION_QUOTE)} — 인용한 파일이 이 트리에 없다.` }),
        reflectMustFix: async (input) => ({ accepted: input.mustFix, rejected: [] }),
      }),
    });
    const submitted = ledger.find(({ event }) => event === 'refute-submitted');
    // ⛔ 「제출됐나」부터 본다 — 배선이 끊기면 자격이 안 서서 «아무것도 안 올라온다»
    expect(submitted).toBeDefined();
    expect(submitted!.data).toMatchObject({ submittedCount: 1, kinds: expect.objectContaining({ 'missing-cited-path': 1 }) });
  });

  test('found cited-path REFUTE가 실제 런에서 파서·refute-submitted까지 닿고 안내 문면이 그 토큰을 담는다', async () => {
    const ledger: Array<{ event: string; data: Record<string, unknown> }> = [];
    const features: string[] = [];
    const finding = 'Fix `InputOwner` — it is missing from the tree.';
    const findingId = stableMustFixId(finding);
    await runSelfImplement({
      feature: 'found cited path escalation wiring',
      maxReworkRounds: 2,
      seams: seams({
        features,
        writeRunLedger: (entry) => { ledger.push(entry as { event: string; data: Record<string, unknown> }); },
        reviewDiff: async () => ({ verdict: 'fail' as const, mustFix: [finding], shouldFix: [], summary: 'found review', reviewed: true }),
        observeCitedPathFacts: (mustFix, _cwd, round) => mustFix.length
          ? [{
            findingId: stableMustFixId(mustFix[0]!),
            path: 'InputOwner',
            existence: 'ambiguous' as const,
            symbolSearch: {
              result: 'found' as const,
              observedScope: ['src'],
              tool: 'ast-grep' as const,
              maxResults: 20,
              evidence: { file: 'src/owner.ts', line: 10, text: 'InputOwner' },
            },
            ...(round === undefined ? {} : { round }),
          }]
          : [],
        implement: async ({ feature }) => {
          features.push(feature);
          return { ok: true, summary: `REFUTE [${findingId}] ${JSON.stringify(FOUND_CITED_PATH_REFUTATION_QUOTE)} — 기계 관측이 그 심볼을 찾았다.` };
        },
        reflectMustFix: async (input) => ({ accepted: input.mustFix, rejected: [] }),
      }),
    });
    const submitted = ledger.find(({ event }) => event === 'refute-submitted');
    expect(submitted).toBeDefined();
    expect(submitted!.data).toMatchObject({ submittedCount: 1, kinds: expect.objectContaining({ 'found-cited-path': 1 }) });
    expect(buildRefutationGuidance()).toContain(JSON.stringify(FOUND_CITED_PATH_REFUTATION_QUOTE));
    expect(buildRefutationGuidance()).toContain(JSON.stringify(MISSING_CITED_PATH_REFUTATION_QUOTE));
    const reworkPrompt = features.find((feature) => feature.includes('[리뷰 인용 경로 관측]')) ?? '';
    expect(reworkPrompt).toContain('[리뷰 인용 경로 관측]');
    expect(reworkPrompt).toContain(JSON.stringify(FOUND_CITED_PATH_REFUTATION_QUOTE));
    expect(reworkPrompt).toContain(JSON.stringify(MISSING_CITED_PATH_REFUTATION_QUOTE));
    expect(reworkPrompt).toContain('found는 같은 라운드 기계 관측이 그 심볼을 찾았다는 관측이다');
  });
});
