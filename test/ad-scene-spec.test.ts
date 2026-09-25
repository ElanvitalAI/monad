import { expect, test } from 'bun:test';
import { createConcept } from '../src/ad-pipeline/concept.js';
import {
  type CameraMove,
  type ProductionCheck,
  type SceneSpec,
  type ShotSize,
  validateSceneSpec,
} from '../src/ad-pipeline/scene-spec.js';

const validCameraMove: CameraMove = 'static';
const validShotSize: ShotSize = 'wide';
const validProductionCheck: ProductionCheck = { kind: 'identity-check' };

// @ts-expect-error CameraMove is a closed union.
const invalidCameraMove: CameraMove = 'orbit';
// @ts-expect-error ShotSize is a closed union.
const invalidShotSize: ShotSize = 'extreme-wide';
// @ts-expect-error ProductionCheck is a tagged union, not a free string.
const invalidProductionCheck: ProductionCheck = 'identity-check';
// @ts-expect-error Beat emotion requires primary.
const emotionWithoutPrimary: SceneSpec['beats'][number]['emotion'] = { secondary: 'calm' };
// @ts-expect-error Beat emotion requires secondary.
const emotionWithoutSecondary: SceneSpec['beats'][number]['emotion'] = { primary: 'calm' };

void validCameraMove;
void validShotSize;
void validProductionCheck;
void invalidCameraMove;
void invalidShotSize;
void invalidProductionCheck;
void emotionWithoutPrimary;
void emotionWithoutSecondary;

const rainyDayUmbrella: SceneSpec = {
  beats: [
    { role: 'hook', startSec: 0, endSec: 5, emotion: { primary: 'loneliness', secondary: 'cold' }, camera: { move: 'static', shotSize: 'wide' }, model: 'seedance_2_0', audio: false, promptCore: 'A person waits alone beneath rain.', checks: [{ kind: 'reference', what: 'person', count: 1 }] },
    { role: 'buildup', startSec: 5, endSec: 12, emotion: { primary: 'hope', secondary: 'hesitation' }, camera: { move: 'tracking', shotSize: 'medium' }, model: 'kling3_0', audio: false, promptCore: 'An umbrella appears through the rain.', checks: [{ kind: 'identity-check' }] },
    { role: 'buildup', startSec: 12, endSec: 20, emotion: { primary: 'trembling', secondary: 'excitement' }, camera: { move: 'push-in', shotSize: 'close-up' }, model: 'kling3_0', audio: true, promptCore: 'Raindrops begin to sound like music.', checks: [{ kind: 'bgm-enter' }] },
    { role: 'climax', startSec: 20, endSec: 28, emotion: { primary: 'joy', secondary: 'release' }, camera: { move: 'dolly-in', shotSize: 'close-up' }, model: 'seedance_2_0', audio: false, promptCore: 'The umbrella opens in a burst of color.', checks: [{ kind: 'static-impact' }] },
    { role: 'transition', startSec: 28, endSec: 30, emotion: { primary: 'afterglow', secondary: 'calm' }, camera: { move: 'static', shotSize: 'medium' }, model: 'kling3_0', audio: false, promptCore: 'Rain fades into a quiet street.', checks: [{ kind: 'end-card', text: 'To be continued' }], transitionIn: { kind: 'dissolve', intent: 'carry the warmth into the ending' } },
  ],
  axes: { hook: 'A lone figure in rain finds shelter.', totalSeconds: 30, lock: { lens: '50mm', lighting: 'rainy dusk', grade: 'cool blue', texture: 'film grain', identity: { kind: 'hero-frame', ref: 'umbrella-hero' } } },
  aspectRatio: '9:16',
  forbidden: ['unsubstantiated claim'],
  provenance: 'generated',
};

test('round-trips the five-beat rainy-day umbrella SceneSpec without loss', () => {
  const roundTrip = JSON.parse(JSON.stringify(rainyDayUmbrella));
  expect(roundTrip).toEqual(rainyDayUmbrella);
  expect(rainyDayUmbrella.beats).toHaveLength(5);
  expect(validateSceneSpec(rainyDayUmbrella)).toMatchObject({ valid: true, errors: [] });
});

test('rejects incomplete emotion, duration mismatch, unsupported aspect ratio, and empty model', () => {
  const incompleteEmotion = validateSceneSpec({ ...rainyDayUmbrella, beats: [{ ...rainyDayUmbrella.beats[0], emotion: { primary: 'loneliness', secondary: ' ' } }, ...rainyDayUmbrella.beats.slice(1)] });
  expect(incompleteEmotion.valid).toBe(false);
  expect(incompleteEmotion.errors.join(' ')).toContain('emotion');

  const blankPrimary = validateSceneSpec({ ...rainyDayUmbrella, beats: [{ ...rainyDayUmbrella.beats[0], emotion: { primary: ' ', secondary: 'cold' } }, ...rainyDayUmbrella.beats.slice(1)] });
  expect(blankPrimary.valid).toBe(false);
  expect(blankPrimary.errors.join(' ')).toContain('emotion');

  const durationMismatch = validateSceneSpec({ ...rainyDayUmbrella, axes: { ...rainyDayUmbrella.axes, totalSeconds: 29 } });
  expect(durationMismatch.valid).toBe(false);
  expect(durationMismatch.errors.join(' ')).toContain('duration sum');

  const unsupportedRatio = validateSceneSpec({ ...rainyDayUmbrella, aspectRatio: '2.39:1' as SceneSpec['aspectRatio'] });
  expect(unsupportedRatio.valid).toBe(false);
  expect(unsupportedRatio.errors.join(' ')).toContain('aspectRatio');

  const emptyModel = validateSceneSpec({ ...rainyDayUmbrella, beats: [{ ...rainyDayUmbrella.beats[0], model: ' ' }, ...rainyDayUmbrella.beats.slice(1)] });
  expect(emptyModel.valid).toBe(false);
  expect(emptyModel.errors.join(' ')).toContain('model');
});

test('preserves an optional SceneSpec without changing the existing concept fields', async () => {
  const survey = { request: { category: 'skincare' }, candidates: [{ id: 'umbrella', label: 'umbrella', reason: 'rainy day', evidence: [{ source: 'source', detail: 'detail' }] }] };
  const concept = await createConcept({ survey, selection: 'umbrella' }, {
    generate: () => ({ candidates: [{ hook: 'Rain', angle: 'shelter' }, { hook: 'Warmth', angle: 'connection' }], categoryForbiddenExpressions: ['cure'], tone: 'calm', scene: rainyDayUmbrella }),
  });
  expect(concept).toMatchObject({ candidates: [{ hook: 'Rain', angle: 'shelter' }, { hook: 'Warmth', angle: 'connection' }], categoryForbiddenExpressions: ['cure'], tone: 'calm', scene: rainyDayUmbrella });
});

test('accepts the 3 and 6 beat boundaries and rejects 2 and 7 beats', () => {
  const threeBeats = { ...rainyDayUmbrella, beats: rainyDayUmbrella.beats.slice(0, 3), axes: { ...rainyDayUmbrella.axes, totalSeconds: 20 } };
  const sixBeats = {
    ...rainyDayUmbrella,
    beats: [...rainyDayUmbrella.beats, { ...rainyDayUmbrella.beats[4], startSec: 30, endSec: 35 }],
    axes: { ...rainyDayUmbrella.axes, totalSeconds: 35 },
  };
  expect(validateSceneSpec(threeBeats).valid).toBe(true);
  expect(validateSceneSpec(sixBeats).valid).toBe(true);

  const twoBeats = { ...rainyDayUmbrella, beats: rainyDayUmbrella.beats.slice(0, 2), axes: { ...rainyDayUmbrella.axes, totalSeconds: 12 } };
  const sevenBeats = {
    ...rainyDayUmbrella,
    beats: [...sixBeats.beats, { ...rainyDayUmbrella.beats[4], startSec: 35, endSec: 40 }],
    axes: { ...rainyDayUmbrella.axes, totalSeconds: 40 },
  };
  expect(validateSceneSpec(twoBeats)).toMatchObject({ valid: false, errors: [expect.stringContaining('between 3 and 6')] });
  expect(validateSceneSpec(sevenBeats)).toMatchObject({ valid: false, errors: [expect.stringContaining('between 3 and 6')] });
});

test('warns rather than rejects beats outside the recommended 5–7 seconds', () => {
  const result = validateSceneSpec(rainyDayUmbrella);
  expect(result.valid).toBe(true);
  expect(result.warnings).toEqual(expect.arrayContaining([
    expect.stringContaining('Beat 3'),
    expect.stringContaining('Beat 4'),
  ]));
});

test('warns for beats shorter than the caller-provided generatable clip length with all remedies', () => {
  const result = validateSceneSpec(rainyDayUmbrella, { minGeneratableSeconds: 4 });
  const shortBeatWarning = result.warnings.find((warning) => warning.includes('generatable clip minimum'));

  expect(result).toMatchObject({ valid: true, errors: [] });
  expect(shortBeatWarning).toContain('Beat 5');
  expect(shortBeatWarning).toContain('4s');
  expect(shortBeatWarning).toContain('최소 길이로 올려 찍고 편집에서 트림');
  expect(shortBeatWarning).toContain('앞 비트에 붙여 한 클립으로 찍는다');
  expect(shortBeatWarning).toContain('스틸 ⊕ 페이드로 편집에서 만든다');
});

test('preserves the complete existing validation result when no options are supplied', () => {
  expect(validateSceneSpec(rainyDayUmbrella)).toEqual({
    valid: true,
    errors: [],
    warnings: [
      'Beat 3 duration 8s is outside the recommended 5–7 seconds.',
      'Beat 4 duration 8s is outside the recommended 5–7 seconds.',
      'Beat 5 duration 2s is outside the recommended 5–7 seconds.',
    ],
  });
});
