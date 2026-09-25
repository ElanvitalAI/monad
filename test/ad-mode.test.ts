import { expect, test } from 'bun:test';
import { modesMissingFinalApproval, FINAL_APPROVAL_GATE,
  AD_MODE_DEFINITIONS,
  DRAFT_MARKER,
  resolveAdMode,
  validateDraftMarkerPlan,
} from '../src/ad-pipeline/mode.js';
import { AD_GATES, createAdPipelinePlan, runAdPipeline, type AdGate } from '../src/ad-pipeline/run.js';

test('modes are defined by locks, configurable cut metadata, and regeneration ceilings', () => {
  expect(resolveAdMode().mode).toBe('medium');
  expect(AD_MODE_DEFINITIONS.quick).toMatchObject({
    locks: [], cutCount: { min: 1, max: 1 }, regenerationCeiling: 0, requiredGates: ['CONCEPT_OK'], requiresDraftMarker: true,
  });
  expect(AD_MODE_DEFINITIONS.medium).toMatchObject({
    locks: ['hero-frame'], cutCount: { min: 3, max: 4 }, regenerationCeiling: 1, requiredGates: ['BRIEF_OK', 'MASTER_PICK', 'VIDEO_OK'],
  });
  expect(AD_MODE_DEFINITIONS.quality).toMatchObject({
    locks: ['soul-cast', 'color'], cutCount: { min: 1, max: 6 }, regenerationCeiling: 2,
    requiredGates: ['CONCEPT_OK', 'BRIEF_OK', 'MASTER_PICK', 'PACK_OK', 'VIDEO_OK'],
  });
});

test('quick plans require an unavoidable non-empty draft marker independent of provenance', () => {
  const quick = createAdPipelinePlan({ kind: 'image', paths: ['/tmp/real-product.jpg'] }, { mode: 'quick' });
  expect(quick.provenance).toBe('real');
  expect(quick.draftMarker).toEqual(DRAFT_MARKER);
  expect(quick.stages).toEqual(AD_GATES);
  expect(createAdPipelinePlan({ kind: 'image', paths: ['/tmp/real-product.jpg'] }, { mode: 'quick', frontRequested: true }).stages).toEqual(['CONCEPT_OK']);
  expect(() => validateDraftMarkerPlan({ mode: 'quick' })).toThrow('Quick plans require');
  expect(() => validateDraftMarkerPlan({ mode: 'quick', draftMarker: { step: ' ', text: DRAFT_MARKER.text } })).toThrow('Quick plans require');
  expect(() => validateDraftMarkerPlan({ mode: 'quick', draftMarker: { step: DRAFT_MARKER.step, text: ' ' } })).toThrow('Quick plans require');
});

const frontDeps = (mode: 'quick' | 'medium' | 'quality' | undefined, approvals: AdGate[]) => ({
  ...(mode ? { mode } : {}),
  frontStage: { survey: { category: 'skincare' }, selection: 'candidate-1' },
  collectSurvey: { collect: () => [{ id: 'candidate-1', label: 'lightweight', reason: 'summer demand', evidence: [{ source: 'https://example.com/trend', detail: 'demand' }] }] },
  generateConcept: { generate: () => ({ candidates: [{ hook: 'h1', angle: 'a1' }, { hook: 'h2', angle: 'a2' }], categoryForbiddenExpressions: [], tone: 'calm' }) },
  approve: (gate: AdGate) => { approvals.push(gate); return true; },
  stage: () => {}, onGrounding: () => {},
});

test('every mode preserves four gates without front inputs', async () => {
  for (const mode of ['quick', 'medium', 'quality'] as const) {
    const approvals: AdGate[] = [];
    const result = await runAdPipeline({ kind: 'text', brief: 'serum campaign' }, {
      mode, approve: (gate) => { approvals.push(gate); return true; }, stage: () => {}, onGrounding: () => {},
    });
    expect(result.status).toBe('gates-approved');
    expect(approvals).toEqual([...AD_GATES]);
    expect(result.plan.stages).toEqual([...AD_GATES]);
    expect(result.plan.mode).toBe(mode);
  }
});

test('front-requested modes execute their complete required gate sets', async () => {
  const expected = {
    quick: ['CONCEPT_OK'],
    medium: ['BRIEF_OK', 'MASTER_PICK', 'VIDEO_OK'],
    quality: ['CONCEPT_OK', 'BRIEF_OK', 'MASTER_PICK', 'PACK_OK', 'VIDEO_OK'],
    default: ['CONCEPT_OK', 'BRIEF_OK', 'MASTER_PICK', 'PACK_OK', 'VIDEO_OK'],
  } as const;
  for (const [mode, gates] of Object.entries(expected)) {
    const approvals: AdGate[] = [];
    const expectedGates = gates as readonly AdGate[];
    const result = await runAdPipeline({ kind: 'text', brief: 'serum campaign' }, frontDeps(mode === 'default' ? undefined : mode as 'quick' | 'medium' | 'quality', approvals));
    expect(result.status).toBe('gates-approved');
    expect(approvals).toEqual([...expectedGates]);
    expect(result.plan.stages).toEqual([...expectedGates]);
  }
});

test('quick output retains its draft marker through the wired execution path', async () => {
  const approvals: AdGate[] = [];
  const result = await runAdPipeline({ kind: 'text', brief: 'serum draft' }, frontDeps('quick', approvals));
  expect(result.status).toBe('gates-approved');
  expect(approvals).toEqual(['CONCEPT_OK']);
  expect(result.plan).toMatchObject({ mode: 'quick', draftMarker: DRAFT_MARKER });
});

test('mode definitions remain immutable across quick executions and quick validation retains its marker contract', async () => {
  const first = await runAdPipeline({ kind: 'text', brief: 'first serum draft' }, {
    ...frontDeps('quick', []),
    approve: (_gate, plan) => {
      expect(() => { (plan.modeDefinition as { mode: string }).mode = 'medium'; }).toThrow(TypeError);
      expect(() => { (plan.modeDefinition.locks as string[]).push('bypass'); }).toThrow(TypeError);
      expect(() => { (plan.modeDefinition.cutCount as { min: number }).min = 0; }).toThrow(TypeError);
      expect(() => { (plan.modeDefinition.requiredGates as string[]).pop(); }).toThrow(TypeError);
      return true;
    },
  });
  expect(first).toMatchObject({ status: 'gates-approved', plan: { mode: 'quick', draftMarker: DRAFT_MARKER } });

  const second = await runAdPipeline({ kind: 'text', brief: 'second serum draft' }, {
    ...frontDeps('quick', []),
    approve: (_gate, plan) => {
      expect(() => { delete (plan as { draftMarker?: unknown }).draftMarker; }).toThrow(TypeError);
      return true;
    },
  });
  expect(second).toMatchObject({ status: 'gates-approved', plan: { mode: 'quick', draftMarker: DRAFT_MARKER } });
  expect(resolveAdMode('quick')).toMatchObject({ mode: 'quick', locks: [], cutCount: { min: 1, max: 1 }, requiredGates: ['CONCEPT_OK'] });
});

test('quick approval callbacks cannot remove, replace, or blank the protected draft marker', async () => {
  const result = await runAdPipeline({ kind: 'text', brief: 'serum draft' }, {
    ...frontDeps('quick', []),
    approve: (_gate, plan) => {
      const mutablePlan = plan as { draftMarker?: { step: string; text: string } };
      expect(() => { delete mutablePlan.draftMarker; }).toThrow(TypeError);
      expect(() => { mutablePlan.draftMarker = { step: 'replacement', text: 'replacement' }; }).toThrow(TypeError);
      expect(() => { (DRAFT_MARKER as { text: string }).text = ' '; }).toThrow(TypeError);
      expect(plan.draftMarker).toEqual(DRAFT_MARKER);
      return true;
    },
  });
  expect(result.status).toBe('gates-approved');
  expect(result.plan.draftMarker).toEqual(DRAFT_MARKER);
});

// 🔴 관계 가드 — ⛔ 「목록」이 아니라 «관계»로 쓴다(목록은 새 모드가 생기면 조용히 면제된다).
//    🩸 초판의 medium 이 이 관계를 깼다: 시안 표식이 «없는데»(=납품 가능) 최종 승인이 «없었다».
test('⛔ 납품될 수 있는 모드는 «최종 승인 게이트»를 가진다 — 시안 표식이 없으면 납품 가능하다', () => {
  // ⭐ 이 시험이 무는 것은 「medium 이 VIDEO_OK 를 갖는가」가 아니라
  //    ***「시안 표식 없음 ⊕ 최종 승인 없음」인 모드가 «하나도 없는가»***다.
  //    ⇒ 새 모드를 더해도 이 시험이 자동으로 묻는다.
  expect(modesMissingFinalApproval()).toEqual([]);

  // quick 은 «면제»된다 — 그러나 공짜가 아니라 «시안 표식을 지는 대가»로 면제된다
  expect(AD_MODE_DEFINITIONS.quick.requiresDraftMarker).toBe(true);
  expect(AD_MODE_DEFINITIONS.quick.requiredGates).not.toContain(FINAL_APPROVAL_GATE);
});
