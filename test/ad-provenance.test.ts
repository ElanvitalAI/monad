import { expect, test } from 'bun:test';
import {
  GENERATED_ASSET_DISCLOSURE,
  hasWiredGeneratedProduction,
  resolveAssetProvenance,
  validateProvenancePlan,
} from '../src/ad-pipeline/provenance.js';
import { AD_GATES, createAdPipelinePlan } from '../src/ad-pipeline/run.js';

test('text plans disclose generated assets with a readable non-empty step', () => {
  const plan = createAdPipelinePlan({ kind: 'text', brief: '프리미엄 세럼 신제품 컨셉 영상' });

  expect(plan.provenance).toBe('generated');
  expect(plan.disclosure).toEqual(GENERATED_ASSET_DISCLOSURE);
  expect(plan.disclosure?.step).toBe('generated-asset-disclosure');
  expect(plan.disclosure?.text.trim().length).toBeGreaterThan(0);
  expect(plan.stages).toEqual(AD_GATES);
});

test('URL plans keep real provenance and disclose only when the generated cut is wired', () => {
  const intake = { kind: 'url' as const, url: 'https://example.com/product' };
  const unwired = createAdPipelinePlan(intake);
  const wired = createAdPipelinePlan(intake, {
    production: {
      cut: { submit: async () => 'job-1', poll: async () => ({ status: 'completed' }) },
      durationRules: { model: { minimumSeconds: 1 } },
      creditsPerSecond: { model: 1 },
      referenceAssets: { model: [] },
      referenceDelivery: { model: { kind: 'single', flag: '--reference' } },
      assembly: {
        scene: {
          beats: [{ role: 'hook', startSec: 0, endSec: 1, emotion: { primary: 'calm', secondary: 'clear' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'product', checks: [] }],
          axes: { hook: 'product', totalSeconds: 1, lock: { lens: '50mm', lighting: 'day', grade: 'neutral', texture: 'clean' } },
          aspectRatio: '9:16',
          forbidden: [],
          provenance: 'real',
        },
        options: { workDir: '/tmp', outputName: 'ad.mp4' },
      },
    },
  });

  expect(unwired.provenance).toBe('real');
  expect(hasWiredGeneratedProduction(unwired.productionReadiness)).toBeFalse();
  expect(unwired.disclosure).toBeUndefined();
  expect(wired.provenance).toBe('real');
  expect(hasWiredGeneratedProduction(wired.productionReadiness)).toBeTrue();
  expect(wired.disclosure).toEqual(GENERATED_ASSET_DISCLOSURE);
  expect(() => validateProvenancePlan(unwired)).not.toThrow();
  expect(() => validateProvenancePlan(wired)).not.toThrow();
});

test('image plans remain real without a wired generated cut', () => {
  const plan = createAdPipelinePlan({ kind: 'image', paths: ['/tmp/product.jpg'] });

  expect(plan.provenance).toBe('real');
  expect(plan.disclosure).toBeUndefined();
  expect(() => validateProvenancePlan(plan)).not.toThrow();
});

test('generated plans fail directly when their disclosure is removed or blanked', () => {
  const plan = createAdPipelinePlan({ kind: 'text', brief: '생성물 광고' });

  expect(() => validateProvenancePlan({ ...plan, disclosure: undefined })).toThrow('Generated assets require');
  expect(() => validateProvenancePlan({ ...plan, disclosure: { step: ' ', text: plan.disclosure!.text } })).toThrow('Generated assets require');
  expect(() => validateProvenancePlan({ ...plan, disclosure: { step: plan.disclosure!.step, text: ' ' } })).toThrow('Generated assets require');
});

test('unresolved provenance remains unresolved and cannot complete a plan', () => {
  expect(resolveAssetProvenance('unknown-intake')).toBe('unresolved');
  expect(() => validateProvenancePlan({ provenance: 'unresolved' })).toThrow('Asset provenance is unresolved');
});
