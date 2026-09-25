import { expect, test } from 'bun:test';
import { calculateCopyProvenance, CONCEPT_VOICEOVER_BLOCKED, createConcept, createDefaultConceptGenerator } from '../src/ad-pipeline/concept.js';
import type { SceneSpec } from '../src/ad-pipeline/scene-spec.js';
import { AD_GATES, AD_GATES_WITH_FRONT, createAdPipelineDeps, runAdPipeline } from '../src/ad-pipeline/run.js';
import { createOmniCrawlSurveyCollector, surveyMarket } from '../src/ad-pipeline/survey.js';

const validCandidate = {
  id: 'c1',
  label: 'lightweight routine',
  reason: 'summer texture demand',
  evidence: [{ source: 'https://example.com/trend', detail: 'lightweight skincare trend' }],
};

const testRewriteVoiceover = async (input: { readonly beatDurations: readonly number[] }): Promise<readonly string[]> => input.beatDurations.map((_, index) => `새 문장 ${index + 1}`);

const voiceoverScene: SceneSpec = {
  beats: [
    { role: 'hook', startSec: 0, endSec: 5, emotion: { primary: 'bright', secondary: 'warm' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: true, promptCore: 'first', checks: [] },
    { role: 'buildup', startSec: 5, endSec: 10, emotion: { primary: 'calm', secondary: 'clear' }, camera: { move: 'pan', shotSize: 'medium' }, model: 'model', audio: true, promptCore: 'second', checks: [] },
    { role: 'climax', startSec: 10, endSec: 15, emotion: { primary: 'joy', secondary: 'energy' }, camera: { move: 'push-in', shotSize: 'close-up' }, model: 'model', audio: true, promptCore: 'third', checks: [] },
    { role: 'transition', startSec: 15, endSec: 20, emotion: { primary: 'calm', secondary: 'clear' }, camera: { move: 'pan', shotSize: 'medium' }, model: 'model', audio: true, promptCore: 'fourth', checks: [] },
  ],
  axes: { hook: 'routine', totalSeconds: 20, lock: { lens: '50mm', lighting: 'soft', grade: 'warm', texture: 'clean' } },
  aspectRatio: '9:16',
  forbidden: [],
  provenance: 'generated',
};

test('survey calls the existing omni-search adapter and returns unranked evidence-backed candidates with ids', async () => {
  let dispatched: Record<string, unknown> | undefined;
  const collector = createOmniCrawlSurveyCollector(async (args) => {
    dispatched = args;
    return { output: '- [lightweight routine](https://example.com/trend)\n  summer texture demand', metadata: { perEngine: {}, totalHits: 1, merge: 'interleave' } };
  });
  const result = await surveyMarket({ category: 'skincare', brand: 'A', competitors: ['B'], season: 'summer' }, collector);
  expect(dispatched).toMatchObject({ query: 'skincare A B summer', merge: 'interleave' });
  expect(result.candidates).toEqual([{ ...validCandidate, id: 'https://example.com/trend', evidence: [{ source: 'https://example.com/trend', detail: 'summer texture demand' }] }]);
  expect('rank' in result.candidates[0]).toBe(false);
  expect('selection' in result).toBe(false);
});

test('survey strips only leading stock markers from collected snippets while preserving candidate fields', async () => {
  const collector = createOmniCrawlSurveyCollector(async () => ({
    output: [
      '- [키링](https://a.test/1)\n  Out of stock포켓몬 포코피아(POKEMON POKOPIA)는 포켓몬과 함께하는 따뜻한 일상을 담은 슬로우 라이프 굿즈 브랜드입니다.',
      '- [드롭](https://a.test/2)\n  In stock: 발매일 2026년 09월 12일 ; 발매가 18,000 KRW',
      '- [망나뇽](https://a.test/3)\n  망나뇽 모습, 메타몽 | 715엔 (약 6,200원) 덩쿠림보 박사',
      '- [설명](https://a.test/4)\n  이 제품은 out of stock 표시가 붙습니다',
      '- [제외됨](https://a.test/5)\n  Out of stock',
    ].join('\n'),
    metadata: { perEngine: {}, totalHits: 5, merge: 'interleave' },
  }));

  const result = await surveyMarket({ category: '캐릭터 굿즈' }, collector);

  expect(result.candidates).toEqual([
    { id: 'https://a.test/1', label: '키링', reason: '포켓몬 포코피아(POKEMON POKOPIA)는 포켓몬과 함께하는 따뜻한 일상을 담은 슬로우 라이프 굿즈 브랜드입니다.', evidence: [{ source: 'https://a.test/1', detail: '포켓몬 포코피아(POKEMON POKOPIA)는 포켓몬과 함께하는 따뜻한 일상을 담은 슬로우 라이프 굿즈 브랜드입니다.' }] },
    { id: 'https://a.test/2', label: '드롭', reason: '발매일 2026년 09월 12일 ; 발매가 18,000 KRW', evidence: [{ source: 'https://a.test/2', detail: '발매일 2026년 09월 12일 ; 발매가 18,000 KRW' }] },
    { id: 'https://a.test/3', label: '망나뇽', reason: '망나뇽 모습, 메타몽 | 715엔 (약 6,200원) 덩쿠림보 박사', evidence: [{ source: 'https://a.test/3', detail: '망나뇽 모습, 메타몽 | 715엔 (약 6,200원) 덩쿠림보 박사' }] },
    { id: 'https://a.test/4', label: '설명', reason: '이 제품은 out of stock 표시가 붙습니다', evidence: [{ source: 'https://a.test/4', detail: '이 제품은 out of stock 표시가 붙습니다' }] },
  ]);
});

test('survey preserves title fallback values when collected results have no snippets', async () => {
  const collector = createOmniCrawlSurveyCollector(async () => ({
    output: [
      '- [In stock](https://a.test/fallback-status)',
      '- [Out of stock키링](https://a.test/fallback-title)',
    ].join('\n'),
    metadata: { perEngine: {}, totalHits: 2, merge: 'interleave' },
  }));

  await expect(surveyMarket({ category: '캐릭터 굿즈' }, collector)).resolves.toEqual({
    request: { category: '캐릭터 굿즈' },
    candidates: [
      { id: 'https://a.test/fallback-status', label: 'In stock', reason: 'In stock', evidence: [{ source: 'https://a.test/fallback-status', detail: 'In stock' }] },
      { id: 'https://a.test/fallback-title', label: 'Out of stock키링', reason: 'Out of stock키링', evidence: [{ source: 'https://a.test/fallback-title', detail: 'Out of stock키링' }] },
    ],
  });
});

test('surveyMarket preserves human-supplied candidate text without parser normalization', async () => {
  const candidate = { id: 'manual', label: '직접 입력', reason: 'Out of stock직접 쓴 문장', evidence: [{ source: 'https://a.test/manual', detail: 'Out of stock직접 쓴 문장' }] };
  await expect(surveyMarket({ category: '캐릭터 굿즈' }, { collect: () => [candidate] })).resolves.toEqual({ request: { category: '캐릭터 굿즈' }, candidates: [candidate] });
});

test('survey excludes URL-only labels while preserving named candidates, URL evidence, and title fallback', async () => {
  const collector = createOmniCrawlSurveyCollector(async () => ({
    output: [
      '- [포켓몬 포코피아 변신메타몽 망나뇽 납작인형 키링](https://pokemon.example/item)\n  한정 굿즈 수요',
      '- [https://essential-japan.com/news/huge-new-ditto-plush-collection-lands](https://essential-japan.com/news/huge-new-ditto-plush-collection-lands)\n  일본 컬렉션 소식',
      '- [무신사 드롭 포켓몬 포코피아 키링](https://musinsa.example/drop)\n  협업 드롭',
      '- [https://www.pokemoncenter.com/product/72-10930-101/pokemon-pokopia-dit](https://www.pokemoncenter.com/product/72-10930-101/pokemon-pokopia-dit)',
      '- [포켓몬 포코피아 인형](https://pokemon.example/plush)',
      '- [https://globalbunjang.com/product/351129591](https://globalbunjang.com/product/351129591)\n  리세일 상품',
      '- [포켓몬 포코피아 굿즈](https://pokemon.example/goods)\n  신상품 출시',
      '- [https://shop.example/only-url](https://shop.example/only-url)\n  판매 페이지',
      '- [https://news.example/only-url](https://news.example/only-url)\n  뉴스 페이지',
    ].join('\n'),
    metadata: { perEngine: {}, totalHits: 9, merge: 'interleave' },
  }));

  const result = await surveyMarket({ category: '캐릭터 굿즈' }, collector);

  expect(result.candidates).toEqual([
    { id: 'https://pokemon.example/item', label: '포켓몬 포코피아 변신메타몽 망나뇽 납작인형 키링', reason: '한정 굿즈 수요', evidence: [{ source: 'https://pokemon.example/item', detail: '한정 굿즈 수요' }] },
    { id: 'https://musinsa.example/drop', label: '무신사 드롭 포켓몬 포코피아 키링', reason: '협업 드롭', evidence: [{ source: 'https://musinsa.example/drop', detail: '협업 드롭' }] },
    { id: 'https://pokemon.example/plush', label: '포켓몬 포코피아 인형', reason: '포켓몬 포코피아 인형', evidence: [{ source: 'https://pokemon.example/plush', detail: '포켓몬 포코피아 인형' }] },
    { id: 'https://pokemon.example/goods', label: '포켓몬 포코피아 굿즈', reason: '신상품 출시', evidence: [{ source: 'https://pokemon.example/goods', detail: '신상품 출시' }] },
  ]);
  expect(result.candidates).toHaveLength(4);
  expect(result.candidates.every((candidate) => !candidate.label.startsWith('http'))).toBe(true);

  const urlOnlyCollector = createOmniCrawlSurveyCollector(async () => ({
    output: '- [https://example.com/only-url](https://example.com/only-url)\n  source detail',
    metadata: { perEngine: {}, totalHits: 1, merge: 'interleave' },
  }));
  await expect(surveyMarket({ category: '캐릭터 굿즈' }, urlOnlyCollector)).rejects.toThrow('Survey collection returned no evidence-backed candidates.');
});

test('survey accepts each available input through the injected collector and blocks only an empty request', async () => {
  const queries: string[] = [];
  const collector = createOmniCrawlSurveyCollector(async ({ query }) => {
    queries.push(query as string);
    return { output: '- [trend](https://example.com/trend)\n  evidence', metadata: { perEngine: {}, totalHits: 1, merge: 'interleave' } };
  });
  await Promise.all([
    collector.collect({ category: 'skincare' }),
    collector.collect({ brand: 'A' }),
    collector.collect({ competitors: ['B'] }),
    collector.collect({ season: 'summer' }),
  ]);
  expect(queries).toEqual(['skincare', 'A', 'B', 'summer']);

  let dispatched = false;
  const emptyCollector = createOmniCrawlSurveyCollector(async () => { dispatched = true; return { output: '', metadata: { perEngine: {}, totalHits: 0, merge: 'interleave' } }; });
  await expect(emptyCollector.collect({})).rejects.toThrow('at least one non-empty category, brand, competitor, or season input');
  expect(dispatched).toBe(false);
  await expect(surveyMarket({ category: 'skincare' }, { collect: () => [{ ...validCandidate, rank: 1 } as typeof validCandidate & { rank: number }] })).resolves.toEqual({ request: { category: 'skincare' }, candidates: [validCandidate] });
  await expect(surveyMarket({ category: 'skincare' }, { collect: () => [{ ...validCandidate, id: ' ' }] })).rejects.toThrow('require an id');
  await expect(surveyMarket({ category: 'skincare' }, { collect: () => [validCandidate, { ...validCandidate, label: 'another' }] })).rejects.toThrow('unique ids');
});

test('concept requires an exact unique human-selected candidate id before generation', async () => {
  const survey = await surveyMarket({ category: 'cosmetics' }, { collect: () => [validCandidate] });
  let generated = false;
  const generator = { generate: () => { generated = true; return { candidates: [{ hook: 'h', angle: 'a' }, { hook: 'h2', angle: 'a2' }], categoryForbiddenExpressions: [], tone: 'calm' }; } };
  await expect(createConcept({ survey, selection: 'not-a-candidate' }, generator)).rejects.toThrow('exactly match one unique');
  expect(generated).toBe(false);
  await expect(createConcept({ survey: { ...survey, candidates: [validCandidate, { ...validCandidate }] }, selection: validCandidate.id }, generator)).rejects.toThrow('exactly match one unique');
  expect(generated).toBe(false);
});

test('concept keeps category forbidden expressions separate from SKU grounding', async () => {
  const survey = await surveyMarket({ category: 'cosmetics' }, { collect: () => [validCandidate] });
  const skuGrounding = { specRows: { '기능성 여부': '해당없음' }, legalStatus: 'not-functional' };
  const concept = await createConcept({ survey, selection: validCandidate.id, skuGrounding }, { generate: () => ({ candidates: [{ hook: '매일 가볍게', angle: 'daily ritual' }, { hook: '산뜻한 루틴', angle: 'lightweight ritual' }], categoryForbiddenExpressions: ['치료', '의약품'], tone: 'calm' }) });
  expect(concept.categoryForbiddenExpressions).toEqual(['치료', '의약품']);
  expect(concept.skuGrounding).toEqual(skuGrounding);
  expect(JSON.stringify(concept.categoryForbiddenExpressions)).not.toContain('해당없음');
});

test('default concept generator applies cosmetic prohibition to confirmed Korean category', async () => {
  const survey = await surveyMarket({ category: '화장품' }, { collect: () => [validCandidate] });
  const concept = await createConcept({ survey, selection: validCandidate.id }, createDefaultConceptGenerator({ rewriteVoiceover: testRewriteVoiceover }));
  const skuGrounding = { specRows: { '기능성 여부': '해당없음' }, legalStatus: 'not-functional' };
  const groundedConcept = await createConcept({ survey, selection: validCandidate.id, skuGrounding }, createDefaultConceptGenerator({ rewriteVoiceover: testRewriteVoiceover }));
  expect(concept.candidates).toHaveLength(2);
  expect(concept.candidates).toEqual([
    { hook: 'lightweight routine: summer texture demand', angle: 'lightweight skincare trend' },
    { hook: 'summer texture demand: lightweight routine', angle: '“lightweight skincare trend”' },
  ]);
  expect(groundedConcept.skuGrounding).toEqual(skuGrounding);
  expect(survey.candidates[0].evidence).toEqual(validCandidate.evidence);
  expect(concept.categoryForbiddenExpressions).toEqual(['치료', '의약품적']);
  expect(concept.tone).toBe('evidence-led 화장품');
  for (const candidate of concept.candidates) {
    const copy = `${candidate.hook} ${candidate.angle}`;
    expect(copy).not.toContain(validCandidate.id);
    expect(copy).not.toContain('http');
    expect(copy).not.toContain('needs evidenced in');
    expect('best' in candidate).toBe(false);
    expect('rank' in candidate).toBe(false);
    expect('selected' in candidate).toBe(false);
  }

  const incompleteSurvey = await surveyMarket({ category: '화장품' }, {
    collect: () => [{ id: 'c2', label: '세', reason: '건', evidence: [{ source: 'https://example.com/short', detail: '리' }] }],
  });
  await expect(createConcept({ survey: incompleteSurvey, selection: 'c2' }, createDefaultConceptGenerator({ rewriteVoiceover: testRewriteVoiceover })))
    .rejects.toThrow('label, reason, and evidence detail that are not single-character fragments');
});

test('default concept generator rewrites voiceover, blocks unavailable or verbatim rewrites, and filters forbidden expressions', async () => {
  const survey = await surveyMarket({ category: '화장품' }, { collect: () => [validCandidate] });
  const request = { survey, selection: validCandidate.id, scene: { ...voiceoverScene, beats: voiceoverScene.beats.slice(0, 2) }, voiceId: 'caller-voice' };
  const rewritten = await createConcept(request, createDefaultConceptGenerator({ rewriteVoiceover: async () => ['새 치료 문장 하나', '새로운 문장 둘'] }));
  if (!rewritten.voiceover || !('lines' in rewritten.voiceover)) throw new Error('Expected rewritten voiceover lines.');
  expect(rewritten.voiceover.lines.map((line) => line.text)).toEqual(['새 문장 하나', '새로운 문장 둘']);
  expect(rewritten.copyProvenance?.lines.every((line) => !line.verbatim)).toBe(true);
  expect(await createConcept(request, createDefaultConceptGenerator({ rewriteVoiceover: async () => ['lightweight routine', '새로운 문장 둘'] }))).toMatchObject({ voiceover: { blocked: 'copy-rewrite-verbatim' } });
  expect(await createConcept(request, createDefaultConceptGenerator({ rewriteVoiceover: async () => { throw new Error('unavailable'); } }))).toMatchObject({ voiceover: { blocked: 'copy-rewrite-unavailable' } });
  expect(await createConcept(request, createDefaultConceptGenerator({ rewriteVoiceover: async () => [] }))).toMatchObject({ voiceover: { blocked: 'copy-rewrite-unavailable' } });
  expect(await createConcept(request, createDefaultConceptGenerator({ rewriteVoiceover: async () => ['새 문장 하나'] }))).toMatchObject({ voiceover: { blocked: 'copy-rewrite-unavailable' } });
});

test('default concept generator gives rewrites per-beat character limits, retries one over-limit response, and blocks a second', async () => {
  const survey = await surveyMarket({ category: 'cosmetics' }, { collect: () => [validCandidate] });
  const request = { survey, selection: validCandidate.id, scene: voiceoverScene, voiceId: 'caller-voice' };
  const inputs: { readonly beatDurations: readonly number[]; readonly characterLimits: readonly number[]; readonly overLimitLines?: readonly { readonly lineNumber: number; readonly length: number; readonly limit: number }[] }[] = [];
  const overLimit = 'this rewritten narration exceeds twenty characters';
  const retried = await createConcept(request, createDefaultConceptGenerator({
    rewriteVoiceover: async (input) => {
      inputs.push(input);
      return inputs.length === 1
        ? [overLimit, 'bright routine', 'gentle nightly glow', 'fresh daily finish']
        : ['bright routine', 'gentle glow', 'daily ritual', 'fresh finish'];
    },
  }));

  expect(inputs).toHaveLength(2);
  expect(inputs[0]?.beatDurations).toEqual([5, 5, 5, 5]);
  expect(inputs[0]?.characterLimits).toEqual([20, 20, 20, 20]);
  expect(inputs[1]?.overLimitLines).toEqual([{ lineNumber: 1, length: overLimit.length, limit: 20 }]);
  if (!retried.voiceover || !('lines' in retried.voiceover)) throw new Error('Expected retried voiceover lines.');
  expect(retried.voiceover.lines.map((line) => line.text)).toEqual(['bright routine', 'gentle glow', 'daily ritual', 'fresh finish']);

  let attempts = 0;
  const blocked = await createConcept(request, createDefaultConceptGenerator({
    rewriteVoiceover: async () => {
      attempts += 1;
      return [overLimit, 'bright routine', 'gentle nightly glow', 'fresh daily finish'];
    },
  }));
  expect(attempts).toBe(2);
  expect(blocked.voiceover).toEqual({ blocked: 'copy-rewrite-too-long' });
});

test('default concept generator retries verbatim rewrites once, shares retry diagnostics, and prioritizes a repeated verbatim result', async () => {
  const survey = await surveyMarket({ category: 'cosmetics' }, { collect: () => [validCandidate] });
  const request = { survey, selection: validCandidate.id, scene: voiceoverScene, voiceId: 'caller-voice' };
  const freshLines = ['bright routine', 'gentle glow', 'daily ritual', 'fresh finish'];

  const recoveredInputs: { readonly overLimitLines?: readonly { readonly lineNumber: number; readonly length: number; readonly limit: number }[]; readonly verbatimLines?: readonly { readonly lineNumber: number }[] }[] = [];
  const recovered = await createConcept(request, createDefaultConceptGenerator({
    rewriteVoiceover: async (input) => {
      recoveredInputs.push(input);
      return recoveredInputs.length === 1
        ? ['lightweight routine', 'gentle glow', 'daily ritual', 'fresh finish']
        : freshLines;
    },
  }));
  expect(recoveredInputs).toHaveLength(2);
  expect(recoveredInputs[1]?.verbatimLines).toEqual([{ lineNumber: 1 }]);
  expect(recoveredInputs[1]?.overLimitLines).toEqual([]);
  if (!recovered.voiceover || !('lines' in recovered.voiceover)) throw new Error('Expected recovered voiceover lines.');
  expect(recovered.voiceover.lines.map((line) => line.text)).toEqual(freshLines);

  let verbatimAttempts = 0;
  const repeatedVerbatim = await createConcept(request, createDefaultConceptGenerator({
    rewriteVoiceover: async () => {
      verbatimAttempts += 1;
      return ['lightweight routine', 'gentle glow', 'daily ritual', 'fresh finish'];
    },
  }));
  expect(verbatimAttempts).toBe(2);
  expect(repeatedVerbatim.voiceover).toEqual({ blocked: 'copy-rewrite-verbatim' });

  const overLimit = 'this rewritten narration exceeds twenty characters';
  let priorityAttempts = 0;
  const overLimitThenVerbatim = await createConcept(request, createDefaultConceptGenerator({
    rewriteVoiceover: async () => {
      priorityAttempts += 1;
      return priorityAttempts === 1
        ? [overLimit, 'gentle glow', 'daily ritual', 'fresh finish']
        : ['lightweight routine', overLimit, 'daily ritual', 'fresh finish'];
    },
  }));
  expect(priorityAttempts).toBe(2);
  expect(overLimitThenVerbatim.voiceover).toEqual({ blocked: 'copy-rewrite-verbatim' });

  const sharedInputs: { readonly overLimitLines?: readonly { readonly lineNumber: number; readonly length: number; readonly limit: number }[]; readonly verbatimLines?: readonly { readonly lineNumber: number }[] }[] = [];
  await createConcept(request, createDefaultConceptGenerator({
    rewriteVoiceover: async (input) => {
      sharedInputs.push(input);
      return sharedInputs.length === 1
        ? [overLimit, 'lightweight routine', 'daily ritual', 'fresh finish']
        : freshLines;
    },
  }));
  expect(sharedInputs).toHaveLength(2);
  expect(sharedInputs[1]?.overLimitLines).toEqual([{ lineNumber: 1, length: overLimit.length, limit: 20 }]);
  expect(sharedInputs[1]?.verbatimLines).toEqual([{ lineNumber: 2 }]);
});

test('copy provenance reports exact substrings and the longest contiguous shared run without a similarity threshold', () => {
  const provenance = calculateCopyProvenance(
    { id: 'https://example.com/source', label: 'Original title', reason: 'direct source sentence', evidence: [{ source: 'https://example.com/source', detail: 'evidence detail' }] },
    [
      { beatIndex: 0, voiceId: 'voice', text: 'source sentence' },
      { beatIndex: 1, voiceId: 'voice', text: 'source sentry' },
    ],
  );

  expect(provenance).toEqual({
    sourceId: 'https://example.com/source',
    lines: [
      { beatIndex: 0, verbatim: true, longestSharedRun: 15 },
      { beatIndex: 1, verbatim: false, longestSharedRun: 11 },
    ],
  });
});

test('default concept generator creates caption-sized, beat-aligned voiceover lines only when scene and voice are supplied', async () => {
  const voiceoverCandidate = {
    id: 'c-voiceover',
    label: '포코피아 무드등',
    reason: '침실 조도를 2700K 로 낮춘다. 은은한 밤',
    evidence: [{ source: 'https://example.com/voiceover', detail: '차분한 수면 준비. 부드러운 빛' }],
  };
  const survey = await surveyMarket({ category: 'cosmetics' }, { collect: () => [voiceoverCandidate] });
  const concept = await createConcept({ survey, selection: voiceoverCandidate.id, scene: voiceoverScene, voiceId: 'caller-voice' }, createDefaultConceptGenerator({ rewriteVoiceover: testRewriteVoiceover }));

  expect(concept.scene).toBe(voiceoverScene);
  expect(concept.voiceover).toEqual(expect.objectContaining({ lines: expect.any(Array) }));
  if (!concept.voiceover || !('lines' in concept.voiceover)) throw new Error('Expected generated voiceover lines.');
  expect(concept.voiceover.lines.map((line) => line.beatIndex)).toEqual([0, 1, 2, 3]);
  expect(concept.voiceover.lines.map((line) => line.voiceId)).toEqual(['caller-voice', 'caller-voice', 'caller-voice', 'caller-voice']);
  const voiceoverTexts = concept.voiceover.lines.map((line) => line.text);
  expect(voiceoverTexts).toEqual(['새 문장 1', '새 문장 2', '새 문장 3', '새 문장 4']);
  expect(concept.copyProvenance).toMatchObject({
    sourceId: 'c-voiceover',
    lines: [
      { beatIndex: 0, verbatim: false },
      { beatIndex: 1, verbatim: false },
      { beatIndex: 2, verbatim: false },
      { beatIndex: 3, verbatim: false },
    ],
  });
  expect(voiceoverTexts.every((text) => !/^[“”"'「」‘’]|[“”"'「」‘’]$/.test(text))).toBe(true);
  expect(voiceoverTexts.every((text) => !text.startsWith('무드등') && !text.startsWith('조도를') && !text.startsWith('수면 준비'))).toBe(true);
  expect(new Set(voiceoverTexts).size).toBe(4);
  for (const line of concept.voiceover.lines) {
    const lines = line.text.split('\n');
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines[0]).not.toBe('');
    expect(lines.every((caption) => caption.length <= 16)).toBe(true);
    expect(line.text.length).toBeLessThanOrEqual((voiceoverScene.beats[line.beatIndex].endSec - voiceoverScene.beats[line.beatIndex].startSec) * 4);
    expect(line.text).not.toContain('치료');
    expect(line.text).not.toContain('의약품적');
    expect(line.text).not.toContain(voiceoverCandidate.id);
    expect(line.text).not.toContain('http');
    expect(line.text).not.toContain('needs evidenced in');
  }

  const repeatedMaterialScene: SceneSpec = {
    ...voiceoverScene,
    beats: voiceoverScene.beats.map((beat, index) => ({
      ...beat,
      role: index % 2 === 0 ? 'hook' : 'buildup',
      emotion: { primary: 'bright', secondary: 'warm' },
    })),
  };
  const repeatedMaterialConcept = await createConcept(
    { survey, selection: voiceoverCandidate.id, scene: repeatedMaterialScene, voiceId: 'caller-voice' },
    createDefaultConceptGenerator({ rewriteVoiceover: testRewriteVoiceover }),
  );
  if (!repeatedMaterialConcept.voiceover || !('lines' in repeatedMaterialConcept.voiceover)) throw new Error('Expected repeated-material voiceover lines.');
  expect(repeatedMaterialConcept.voiceover.lines.map((line) => line.beatIndex)).toEqual([0, 1, 2, 3]);
  expect(repeatedMaterialConcept.voiceover.lines.map((line) => line.voiceId)).toEqual(['caller-voice', 'caller-voice', 'caller-voice', 'caller-voice']);
  expect(repeatedMaterialConcept.voiceover.lines.every((line) => line.text.trim() !== '')).toBe(true);
  expect(new Set(repeatedMaterialConcept.voiceover.lines.map((line) => line.text)).size).toBe(repeatedMaterialConcept.voiceover.lines.length);

  const withoutScene = await createConcept({ survey, selection: voiceoverCandidate.id, voiceId: 'caller-voice' }, createDefaultConceptGenerator({ rewriteVoiceover: testRewriteVoiceover }));
  expect(withoutScene.voiceover).toBeUndefined();
  const withoutVoice = await createConcept({ survey, selection: voiceoverCandidate.id, scene: voiceoverScene }, createDefaultConceptGenerator({ rewriteVoiceover: testRewriteVoiceover }));
  expect(withoutVoice.voiceover).toEqual({ blocked: CONCEPT_VOICEOVER_BLOCKED });
});


test('concept rejects a single candidate so the next approval can compare multiple angles', async () => {
  const survey = await surveyMarket({ category: 'skincare' }, { collect: () => [validCandidate] });
  await expect(createConcept({ survey, selection: validCandidate.id }, {
    generate: () => ({ candidates: [{ hook: '한 가지 훅', angle: '한 가지 앵글' }], categoryForbiddenExpressions: ['치료'], tone: 'calm' }),
  })).rejects.toThrow('multiple non-empty hook and angle candidates');
});

test('runAdPipeline blocks invalid selection before approvals and later callbacks', async () => {
  const calls: string[] = [];
  const result = await runAdPipeline({ kind: 'text', brief: 'serum video' }, {
    frontStage: { survey: { category: 'skincare' }, selection: 'wrong-id' },
    collectSurvey: { collect: () => { calls.push('survey'); return [validCandidate]; } },
    generateConcept: { generate: () => { calls.push('concept'); return { candidates: [{ hook: 'h', angle: 'a' }, { hook: 'h2', angle: 'a2' }], categoryForbiddenExpressions: [], tone: 'calm' }; } },
    approve: (gate) => { calls.push(`approve:${gate}`); return true; }, stage: (gate) => { calls.push(`stage:${gate}`); }, onGrounding: () => {},
  });
  expect(result).toMatchObject({ status: 'blocked', reason: expect.stringContaining('exactly match one unique') });
  expect(calls).toEqual(['survey']);
});

test('runAdPipeline collects survey before requesting selection, then creates the concept once', async () => {
  const calls: string[] = [];
  const result = await runAdPipeline({ kind: 'text', brief: 'serum video' }, {
    frontStage: { survey: { category: 'skincare' } },
    collectSurvey: { collect: () => { calls.push('survey'); return [validCandidate]; } },
    selectSurveyCandidate: (survey) => { calls.push(`select:${survey.candidates[0].id}`); return validCandidate.id; },
    // ⛔ 후보는 «둘 이상»이어야 한다 — main 의 계약(「다음 승인이 각도를 비교할 수 있어야 한다」).
    generateConcept: { generate: () => { calls.push('concept'); return { candidates: [{ hook: 'h', angle: 'a' }, { hook: 'h2', angle: 'a2' }], categoryForbiddenExpressions: [], tone: 'calm' }; } },
    approve: (gate) => { calls.push(`approve:${gate}`); return false; },
    stage: () => {},
    onGrounding: () => {},
  });
  expect(result).toMatchObject({ status: 'rejected', stoppedGate: 'CONCEPT_OK', plan: { concept: { selection: validCandidate.id } } });
  expect(calls).toEqual(['survey', `select:${validCandidate.id}`, 'concept', 'approve:CONCEPT_OK']);
});

test('CONCEPT_OK displays front stages and rejects before later callbacks', async () => {
  const lines: string[] = [];
  const deps = createAdPipelineDeps({
    ask: () => false,
    report: (line) => { lines.push(line); },
    frontStage: { survey: { category: 'skincare' }, selection: validCandidate.id },
    collectSurvey: { collect: () => [validCandidate] },
    generateConcept: createDefaultConceptGenerator({ rewriteVoiceover: testRewriteVoiceover }),
  });
  const result = await runAdPipeline({ kind: 'text', brief: 'serum video' }, deps);
  expect(result).toMatchObject({ status: 'rejected', stoppedGate: 'CONCEPT_OK' });
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain('조사 후보:');
  expect(lines[1]).toContain('구상:');
});

test('runAdPipeline reaches front stages and preserves the five-gate order', async () => {
  const calls: string[] = [];
  const result = await runAdPipeline({ kind: 'text', brief: 'serum video' }, {
    frontStage: { survey: { category: 'skincare', season: 'summer' }, selection: validCandidate.id, skuGrounding: { specRows: { '기능성 여부': '해당없음' } } },
    collectSurvey: { collect: () => { calls.push('survey'); return [validCandidate]; } },
    generateConcept: { generate: () => { calls.push('concept'); return { candidates: [{ hook: '가볍게 시작', angle: 'ritual' }, { hook: '여름의 가벼움', angle: 'summer texture' }], categoryForbiddenExpressions: ['치료'], tone: 'calm' }; } },
    approve: (gate) => { calls.push(`approve:${gate}`); return false; }, stage: (gate) => { calls.push(`stage:${gate}`); }, onGrounding: () => {},
  });
  // ⛔ 게이트 목록이 «둘»이다 — 앞쪽을 부탁했을 때만 다섯이 된다. 넷은 그대로 살아 있어야 한다.
  expect(AD_GATES).toEqual(['BRIEF_OK', 'MASTER_PICK', 'PACK_OK', 'VIDEO_OK']);
  expect(AD_GATES_WITH_FRONT).toEqual(['CONCEPT_OK', 'BRIEF_OK', 'MASTER_PICK', 'PACK_OK', 'VIDEO_OK']);
  expect(result.plan.stages).toEqual(AD_GATES_WITH_FRONT);
  expect(result).toMatchObject({ status: 'rejected', stoppedGate: 'CONCEPT_OK', plan: { survey: { candidates: [{ id: validCandidate.id, reason: 'summer texture demand' }] }, concept: { selection: validCandidate.id, categoryForbiddenExpressions: ['치료'] } } });
  expect(calls).toEqual(['survey', 'concept', 'approve:CONCEPT_OK']);
});

// 🔴 회귀 가드 — 이 시험이 «없어서» 자식이 기존 입구 셋을 전부 blocked 로 접었다(시험 7개 빨강).
//    📌 반증: run.ts 에서 frontRequested 분기를 지우고 앞쪽을 «필수»로 되돌리면 이 시험이 빨강이어야 한다.
test('⛔ 앞쪽을 «안 부탁하면» 게이트는 «넷» 그대로다 — CLI·TUI·텔레그램이 오늘까지처럼 돈다', async () => {
  const seen: string[] = [];
  const result = await runAdPipeline({ kind: 'text', brief: 'serum video' }, {
    approve: (gate) => { seen.push(gate); return true; },
    stage: () => {}, onGrounding: () => {},
  });
  expect(seen).toEqual(['BRIEF_OK', 'MASTER_PICK', 'PACK_OK', 'VIDEO_OK']);
  expect(result.status).toBe('gates-approved');
  expect(result.plan.stages).toEqual(AD_GATES);
  // ⛔ 「부탁 안 함」과 「부탁했는데 재료가 덜 옴」은 «다른 값»이다
  const partial = await runAdPipeline({ kind: 'text', brief: 'serum video' }, {
    frontStage: { survey: { category: 'skincare' }, selection: 'x' },
    approve: () => true, stage: () => {}, onGrounding: () => {},
  });
  expect(partial.status).toBe('blocked');
});
