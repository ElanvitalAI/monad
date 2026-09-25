import { expect, test } from 'bun:test';
import { buildShootPlan } from '../src/ad-pipeline/shoot-plan.js';
import type { SceneSpec } from '../src/ad-pipeline/scene-spec.js';

const scene: SceneSpec = {
  beats: [
    { role: 'hook', startSec: 0, endSec: 5, emotion: { primary: 'calm', secondary: 'bright' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model-a', audio: false, promptCore: 'First product shot', checks: [] },
    { role: 'buildup', startSec: 5, endSec: 10, emotion: { primary: 'hope', secondary: 'warmth' }, camera: { move: 'pan', shotSize: 'medium' }, model: 'model-b', audio: false, promptCore: 'Second product shot', checks: [] },
    { role: 'climax', startSec: 10, endSec: 15, emotion: { primary: 'joy', secondary: 'energy' }, camera: { move: 'push-in', shotSize: 'close-up' }, model: 'model-a', audio: true, promptCore: 'Third product shot', checks: [] },
    { role: 'transition', startSec: 15, endSec: 20, emotion: { primary: 'calm', secondary: 'softness' }, camera: { move: 'static', shotSize: 'medium' }, model: 'model-c', audio: false, promptCore: 'Fourth product shot', checks: [] },
    { role: 'transition', startSec: 20, endSec: 22, emotion: { primary: 'rest', secondary: 'clarity' }, camera: { move: 'static', shotSize: 'medium' }, model: 'model-c', audio: false, promptCore: 'Fifth product shot', checks: [] },
  ],
  axes: { hook: 'Serum', totalSeconds: 22, lock: { lens: '50mm', lighting: 'soft', grade: 'neutral', texture: 'clean' } },
  aspectRatio: '9:16',
  forbidden: [],
  provenance: 'generated',
};

test('raises short beat durations and retains the requested edit trim without executing anything', () => {
  const plan = buildShootPlan(scene, { mode: 'quality', minGeneratableSeconds: 4, creditsPerSecond: { 'model-a': 2, 'model-b': 3, 'model-c': 4 } });

  expect(plan.commands[4]).toMatchObject({
    beatIndex: 4,
    jobType: 'model-c',
    durationSeconds: 4,
    trimToSeconds: 2,
    args: ['--prompt', 'Fifth product shot', '--aspect-ratio', '9:16'],
    estimatedCredits: 16,
  });
  expect(plan.commands.every((command) => command.args.includes('--aspect-ratio') && command.args.includes('9:16'))).toBe(true);
  expect(plan).toMatchObject({ unpriced: [], blocked: [], totalEstimatedCredits: 71 });
});

test('uses injected per-model duration rules, allowed values, and marks unknown rules unpriced', () => {
  const variedDurations = buildShootPlan({
    ...scene,
    beats: [
      { ...scene.beats[0], model: 'kling3_0_turbo', endSec: 2 },
      { ...scene.beats[1], model: 'seedance_2_0', startSec: 5, endSec: 7 },
      { ...scene.beats[2], model: 'seedance1_5', startSec: 10, endSec: 15 },
      { ...scene.beats[3], model: 'unknown-model' },
    ],
  }, {
    mode: 'quality',
    durationRules: {
      kling3_0_turbo: { minimumSeconds: 3 },
      seedance_2_0: { minimumSeconds: 4 },
      seedance1_5: { allowedSeconds: [4, 8, 12] },
    },
    creditsPerSecond: { kling3_0_turbo: 1, seedance_2_0: 1, seedance1_5: 1 },
  });

  expect(variedDurations.commands).toMatchObject([
    { jobType: 'kling3_0_turbo', durationSeconds: 3, trimToSeconds: 2 },
    { jobType: 'seedance_2_0', durationSeconds: 4, trimToSeconds: 2 },
    { jobType: 'seedance1_5', durationSeconds: 8, trimToSeconds: 5 },
  ]);
  expect(variedDurations.unpriced).toEqual([3]);
  expect(variedDurations.commands.every((command) => command.args.includes('--aspect-ratio') && command.args.includes('9:16'))).toBe(true);
});

test('emits injected reference assets, reuses them for identity checks, and distinguishes non-blocking readiness', () => {
  const referenceScene: SceneSpec = {
    ...scene,
    beats: [
      { ...scene.beats[0], checks: [{ kind: 'reference', what: 'person', count: 2 }] },
      { ...scene.beats[1], checks: [{ kind: 'identity-check' }] },
      { ...scene.beats[2], checks: [{ kind: 'reference', what: 'missing-person', count: 1 }] },
      { ...scene.beats[3], checks: [{ kind: 'reference', what: 'too-many', count: 3 }] },
    ],
  };
  const plan = buildShootPlan(referenceScene, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person-a.png', 'person-b.png'], 'too-many': ['one.png', 'two.png', 'three.png'] },
    referenceLimits: { 'model-a': { maxImageReferences: 2, maxReferenceFiles: 3 }, 'model-b': { maxImageReferences: 2, maxReferenceFiles: 3 }, 'model-c': { maxImageReferences: 2, maxReferenceFiles: 3 } },
    referenceDelivery: { 'model-a': { kind: 'repeated', flag: '--image-references' }, 'model-b': { kind: 'repeated', flag: '--image-references' }, 'model-c': { kind: 'repeated', flag: '--image-references' } },
  });

  expect(plan.commands[0]).toMatchObject({
    args: ['--prompt', 'First product shot', '--aspect-ratio', '9:16', '--image-references', 'person-a.png', '--image-references', 'person-b.png'],
    referenceReadiness: { kind: 'ready', assets: ['person-a.png', 'person-b.png'] },
  });
  expect(plan.commands[1]).toMatchObject({
    args: ['--prompt', 'Second product shot', '--aspect-ratio', '9:16', '--image-references', 'person-a.png', '--image-references', 'person-b.png'],
    referenceReadiness: { kind: 'ready', assets: ['person-a.png', 'person-b.png'] },
  });
  expect(plan.commands[2]).toMatchObject({
    referenceReadiness: { kind: 'missing', missing: [{ what: 'missing-person', required: 1, available: 0 }] },
  });
  expect(plan.commands[3]).toMatchObject({
    referenceReadiness: { kind: 'over-limit', assetCount: 3, limit: 2 },
  });
  expect(plan.commands[2].args).not.toContain('--image-references');
  expect(plan.commands[3].args).not.toContain('--image-references');
  expect(plan.commands).toHaveLength(4);
  expect(plan.blocked).toEqual([]);
});

test('blocks legible-writing without its declared reference before creating commands', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [{ ...scene.beats[0], checks: [{ kind: 'legible-writing', what: 'handwritten-note' }] }],
  }, { mode: 'quality', minGeneratableSeconds: 4 });

  expect(plan).toEqual({
    commands: [],
    unpriced: [0],
    blocked: ['missing-legible-writing-reference:beat-1:handwritten-note'],
  });
});

test('blocks only a legible-writing beat that lacks its declared reference', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [
      scene.beats[0],
      { ...scene.beats[1], checks: [{ kind: 'legible-writing', what: 'handwritten-note' }] },
    ],
  }, { mode: 'quality', minGeneratableSeconds: 4 });

  expect(plan.blocked).toEqual(['missing-legible-writing-reference:beat-2:handwritten-note']);
  expect(plan.unpriced).toEqual([0, 1]);
  expect(plan.commands).toHaveLength(1);
  expect(plan.commands[0]).toMatchObject({
    beatIndex: 0,
    args: ['--prompt', 'First product shot', '--aspect-ratio', '9:16'],
  });
});

test('delivers a declared legible-writing reference without changing undeclared beats', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [
      { ...scene.beats[0], checks: [{ kind: 'legible-writing', what: 'handwritten-note' }] },
      scene.beats[1],
    ],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { 'handwritten-note': ['note.png'] },
    referenceDelivery: { 'model-a': { kind: 'repeated', flag: '--image-references' } },
  });

  expect(plan.blocked).toEqual([]);
  expect(plan.commands).toHaveLength(2);
  expect(plan.commands[0].args).toEqual([
    '--prompt', 'First product shot', '--aspect-ratio', '9:16', '--image-references', 'note.png',
  ]);
  expect(plan.commands[1].args).toEqual(['--prompt', 'Second product shot', '--aspect-ratio', '9:16']);
});

test('delivers legible-writing alongside an identity reference without changing identity reuse', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [
      {
        ...scene.beats[0],
        checks: [
          { kind: 'reference', what: 'person', count: 1 },
          { kind: 'legible-writing', what: 'handwritten-note' },
          { kind: 'identity-check' },
        ],
      },
      { ...scene.beats[1], checks: [{ kind: 'identity-check' }] },
    ],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person.png'], 'handwritten-note': ['note.png'] },
    referenceDelivery: {
      'model-a': { kind: 'repeated', flag: '--image-references' },
      'model-b': { kind: 'repeated', flag: '--image-references' },
    },
  });

  expect(plan.blocked).toEqual([]);
  expect(plan.commands[0]).toMatchObject({
    referenceReadiness: { kind: 'ready', assets: ['person.png', 'note.png'] },
    args: [
      '--prompt', 'First product shot', '--aspect-ratio', '9:16',
      '--image-references', 'person.png', '--image-references', 'note.png',
    ],
  });
  expect(plan.commands[1]).toMatchObject({
    referenceReadiness: { kind: 'ready', assets: ['person.png'] },
    args: [
      '--prompt', 'Second product shot', '--aspect-ratio', '9:16',
      '--image-references', 'person.png',
    ],
  });
  expect(plan.commands[1].args).not.toContain('note.png');
});

test('delivers legible-writing alongside a reused identity without retaining it as identity state', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [
      { ...scene.beats[0], checks: [{ kind: 'reference', what: 'person', count: 1 }] },
      { ...scene.beats[1], checks: [{ kind: 'identity-check' }, { kind: 'legible-writing', what: 'handwritten-note' }] },
      { ...scene.beats[2], checks: [{ kind: 'identity-check' }] },
    ],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person.png'], 'handwritten-note': ['note.png'] },
    referenceDelivery: {
      'model-a': { kind: 'repeated', flag: '--image-references' },
      'model-b': { kind: 'repeated', flag: '--image-references' },
    },
  });

  expect(plan.blocked).toEqual([]);
  expect(plan.commands[1].args).toEqual([
    '--prompt', 'Second product shot', '--aspect-ratio', '9:16',
    '--image-references', 'person.png', '--image-references', 'note.png',
  ]);
  expect(plan.commands[2].args).toEqual([
    '--prompt', 'Third product shot', '--aspect-ratio', '9:16',
    '--image-references', 'person.png',
  ]);
  expect(plan.commands[2].args).not.toContain('note.png');
});

test('uses the injected per-model reference-delivery contract for repeated and single references', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [
      { ...scene.beats[0], model: 'repeated-model', checks: [{ kind: 'reference', what: 'person', count: 2 }] },
      { ...scene.beats[1], model: 'single-model', checks: [{ kind: 'reference', what: 'person', count: 1 }] },
    ],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person-a.png', 'person-b.png'] },
    referenceDelivery: {
      'repeated-model': { kind: 'repeated', flag: '--image-references' },
      'single-model': { kind: 'single', flag: '--start-image' },
    },
  });

  expect(plan.commands[0].args).toEqual([
    '--prompt', 'First product shot', '--aspect-ratio', '9:16',
    '--image-references', 'person-a.png', '--image-references', 'person-b.png',
  ]);
  expect(plan.commands[1].args).toEqual([
    '--prompt', 'Second product shot', '--aspect-ratio', '9:16',
    '--start-image', 'person-a.png',
  ]);
  expect(plan.commands.map((command) => command.referenceReadiness)).toEqual([
    { kind: 'ready', assets: ['person-a.png', 'person-b.png'] },
    { kind: 'ready', assets: ['person-a.png'] },
  ]);
});

test('emits the injected repeated flag without substituting a semantic default', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [{ ...scene.beats[0], model: 'alternate-repeated-model', checks: [{ kind: 'reference', what: 'person', count: 2 }] }],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person-a.png', 'person-b.png'] },
    referenceDelivery: { 'alternate-repeated-model': { kind: 'repeated', flag: '--reference-image' } },
  });

  expect(plan.commands[0].args).toEqual([
    '--prompt', 'First product shot', '--aspect-ratio', '9:16',
    '--reference-image', 'person-a.png', '--reference-image', 'person-b.png',
  ]);
  expect(plan.commands[0].args).not.toContain('--image-references');
});

test('reports a single delivery as missing when its one delivered asset cannot satisfy the declaration', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [{ ...scene.beats[0], model: 'single-model', checks: [{ kind: 'reference', what: 'person', count: 2 }] }],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person-a.png', 'person-b.png'] },
    referenceDelivery: { 'single-model': { kind: 'single', flag: '--start-image' } },
  });

  expect(plan.commands[0]).toMatchObject({
    args: ['--prompt', 'First product shot', '--aspect-ratio', '9:16', '--start-image', 'person-a.png'],
    referenceReadiness: { kind: 'missing', missing: [{ what: 'person', required: 2, available: 1 }] },
  });
});

test('does not resurrect an undelivered reference during later identity reuse', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [
      { ...scene.beats[0], model: 'repeated-model', checks: [{ kind: 'reference', what: 'person', count: 2 }] },
      { ...scene.beats[1], model: 'single-model', checks: [{ kind: 'reference', what: 'person', count: 1 }, { kind: 'identity-check' }] },
      { ...scene.beats[2], model: 'repeated-model', checks: [{ kind: 'reference', what: 'person', count: 2 }, { kind: 'identity-check' }] },
    ],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person-a.png', 'person-b.png'] },
    referenceDelivery: {
      'repeated-model': { kind: 'repeated', flag: '--image-references' },
      'single-model': { kind: 'single', flag: '--start-image' },
    },
  });

  expect(plan.commands[1].args).toContain('--start-image');
  expect(plan.commands[1].args).not.toContain('person-b.png');
  expect(plan.commands[2]).toMatchObject({
    referenceReadiness: { kind: 'missing', missing: [{ what: 'person', required: 2, available: 0 }] },
  });
  expect(plan.commands[2].args).not.toContain('person-b.png');
});

test('does not resurrect an undelivered reference after an identity-only single delivery', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [
      { ...scene.beats[0], model: 'repeated-model', checks: [{ kind: 'reference', what: 'person', count: 2 }] },
      { ...scene.beats[1], model: 'single-model', checks: [{ kind: 'identity-check' }] },
      { ...scene.beats[2], model: 'repeated-model', checks: [{ kind: 'reference', what: 'person', count: 2 }, { kind: 'identity-check' }] },
    ],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person-a.png', 'person-b.png'] },
    referenceDelivery: {
      'repeated-model': { kind: 'repeated', flag: '--image-references' },
      'single-model': { kind: 'single', flag: '--start-image' },
    },
  });

  expect(plan.commands[1].args).toEqual([
    '--prompt', 'Second product shot', '--aspect-ratio', '9:16', '--start-image', 'person-a.png',
  ]);
  expect(plan.commands[2]).toMatchObject({
    referenceReadiness: { kind: 'missing', missing: [{ what: 'person', required: 2, available: 0 }] },
  });
  expect(plan.commands[2].args).not.toContain('person-b.png');
});

test('omits references and exposes unsupported readiness when no model delivery is configured', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [{ ...scene.beats[0], model: 'unconfigured-model', checks: [{ kind: 'reference', what: 'person', count: 1 }] }],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person-a.png'] },
  });

  expect(plan.commands[0]).toMatchObject({
    args: ['--prompt', 'First product shot', '--aspect-ratio', '9:16'],
    referenceReadiness: { kind: 'missing', missing: [{ what: 'person', required: 1, available: 0 }] },
    referenceDeliveryReadiness: { kind: 'unconfigured' },
  });
  expect(plan.blocked).toEqual([]);
});

test('reports only delivered references when delivery is unconfigured without blocking the command', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [{ ...scene.beats[0], model: 'unconfigured-model', checks: [{ kind: 'reference', what: 'person', count: 2 }] }],
  }, { mode: 'quality', minGeneratableSeconds: 4, referenceAssets: { person: ['person-a.png'] } });

  expect(plan.commands[0]).toMatchObject({
    args: ['--prompt', 'First product shot', '--aspect-ratio', '9:16'],
    referenceReadiness: { kind: 'missing', missing: [{ what: 'person', required: 2, available: 0 }] },
    referenceDeliveryReadiness: { kind: 'unconfigured' },
  });
  expect(plan.blocked).toEqual([]);
});

test('marks an identity-reused reference missing when the selected assets do not meet a later declaration', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [
      { ...scene.beats[0], checks: [{ kind: 'reference', what: 'person', count: 1 }] },
      { ...scene.beats[1], checks: [{ kind: 'reference', what: 'person', count: 2 }, { kind: 'identity-check' }] },
    ],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person-a.png', 'person-b.png'] },
    referenceDelivery: { 'model-a': { kind: 'repeated', flag: '--image-references' }, 'model-b': { kind: 'repeated', flag: '--image-references' }, 'model-c': { kind: 'repeated', flag: '--image-references' } },
  });

  expect(plan.commands[0]).toMatchObject({ referenceReadiness: { kind: 'ready', assets: ['person-a.png'] } });
  expect(plan.commands[1]).toMatchObject({
    referenceReadiness: { kind: 'missing', missing: [{ what: 'person', required: 2, available: 0 }] },
  });
  expect(plan.commands[1].args).not.toContain('--image-references');
});

test('keeps a single declared identity reference ready and reuses the same asset', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [
      { ...scene.beats[0], checks: [{ kind: 'reference', what: 'person', count: 1 }, { kind: 'identity-check' }] },
      { ...scene.beats[1], checks: [{ kind: 'identity-check' }] },
    ],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person-a.png'] },
    referenceDelivery: { 'model-a': { kind: 'repeated', flag: '--image-references' }, 'model-b': { kind: 'repeated', flag: '--image-references' } },
  });

  expect(plan.commands[0]).toMatchObject({ referenceReadiness: { kind: 'ready', assets: ['person-a.png'] } });
  expect(plan.commands[1]).toMatchObject({ referenceReadiness: { kind: 'ready', assets: ['person-a.png'] } });
  expect(plan.commands[1].args).toContain('person-a.png');
});

test('anchors identity to its declared reference even when incomplete and continues to validate later declarations', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [
      { ...scene.beats[0], checks: [{ kind: 'reference', what: 'person', count: 2 }, { kind: 'identity-check' }] },
      { ...scene.beats[1], checks: [{ kind: 'reference', what: 'person', count: 2 }, { kind: 'identity-check' }] },
      { ...scene.beats[2], checks: [{ kind: 'reference', what: 'product', count: 1 }] },
      { ...scene.beats[3], checks: [{ kind: 'identity-check' }] },
    ],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person-a.png'], product: ['serum.png'] },
    referenceDelivery: { 'model-a': { kind: 'repeated', flag: '--image-references' }, 'model-b': { kind: 'repeated', flag: '--image-references' }, 'model-c': { kind: 'repeated', flag: '--image-references' } },
  });

  const missingPerson = { kind: 'missing', missing: [{ what: 'person', required: 2, available: 0 }] };
  expect(plan.commands[0]).toMatchObject({ referenceReadiness: missingPerson });
  expect(plan.commands[1]).toMatchObject({ referenceReadiness: missingPerson });
  expect(plan.commands[1].args).not.toContain('--image-references');
  expect(plan.commands[2]).toMatchObject({ referenceReadiness: { kind: 'ready', assets: ['serum.png'] } });
  expect(plan.commands[3]).toMatchObject({ referenceReadiness: { kind: 'ready', assets: ['serum.png'] } });
  expect(plan.commands[3].args).not.toContain('person-a.png');
  expect(plan.commands[3].args).toContain('serum.png');
  expect(plan.blocked).toEqual([]);
});

test('reports missing declarations and injected reference limit overflow together without blocking', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [{ ...scene.beats[0], checks: [{ kind: 'reference', what: 'person', count: 3 }, { kind: 'reference', what: 'wardrobe', count: 1 }] }],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person-a.png', 'person-b.png', 'person-c.png'] },
    referenceLimits: { 'model-a': { maxImageReferences: 2 } },
  });

  expect(plan.commands[0]).toMatchObject({
    referenceReadiness: {
      kind: 'missing',
      missing: [
        { what: 'person', required: 3, available: 0 },
        { what: 'wardrobe', required: 1, available: 0 },
      ],
    },
  });
  expect(plan.commands[0].args).not.toContain('--image-references');
  expect(plan.blocked).toEqual([]);
});

test('reuses only the latest command selection for identity checks', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [
      { ...scene.beats[0], checks: [{ kind: 'reference', what: 'person', count: 1 }, { kind: 'reference', what: 'product', count: 1 }] },
      { ...scene.beats[1], checks: [{ kind: 'reference', what: 'person', count: 2 }] },
      { ...scene.beats[2], checks: [{ kind: 'identity-check' }] },
    ],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person-a.png', 'person-b.png'], product: ['serum.png'] },
    referenceDelivery: { 'model-a': { kind: 'repeated', flag: '--image-references' }, 'model-b': { kind: 'repeated', flag: '--image-references' }, 'model-c': { kind: 'repeated', flag: '--image-references' } },
  });

  expect(plan.commands[0]).toMatchObject({ referenceReadiness: { kind: 'ready', assets: ['person-a.png', 'serum.png'] } });
  expect(plan.commands[1]).toMatchObject({ referenceReadiness: { kind: 'ready', assets: ['person-a.png', 'person-b.png'] } });
  expect(plan.commands[2]).toMatchObject({ referenceReadiness: { kind: 'ready', assets: ['person-a.png', 'person-b.png'] } });
  expect(plan.commands[2].args).toEqual([
    '--prompt', 'Third product shot', '--aspect-ratio', '9:16',
    '--image-references', 'person-a.png', '--image-references', 'person-b.png',
  ]);
  expect(plan.commands[2].args).not.toContain('serum.png');
});

test('preserves selections for references introduced in separate earlier beats before identity reuse', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [
      { ...scene.beats[0], checks: [{ kind: 'reference', what: 'person', count: 1 }] },
      { ...scene.beats[1], checks: [{ kind: 'reference', what: 'product', count: 1 }] },
      { ...scene.beats[2], checks: [{ kind: 'reference', what: 'person', count: 1 }, { kind: 'reference', what: 'product', count: 1 }, { kind: 'identity-check' }] },
    ],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person.png'], product: ['serum.png'] },
    referenceDelivery: { 'model-a': { kind: 'repeated', flag: '--image-references' }, 'model-b': { kind: 'repeated', flag: '--image-references' }, 'model-c': { kind: 'repeated', flag: '--image-references' } },
  });

  expect(plan.commands[2]).toMatchObject({
    referenceReadiness: { kind: 'ready', assets: ['person.png', 'serum.png'] },
  });
  expect(plan.commands[2].args).toEqual([
    '--prompt', 'Third product shot', '--aspect-ratio', '9:16',
    '--image-references', 'person.png', '--image-references', 'serum.png',
  ]);
});

test('does not select a new reference for an unestablished identity what', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [
      { ...scene.beats[0], checks: [{ kind: 'reference', what: 'person', count: 1 }] },
      { ...scene.beats[1], checks: [{ kind: 'reference', what: 'product', count: 1 }, { kind: 'identity-check' }] },
    ],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person.png'], product: ['serum.png'] },
    referenceDelivery: { 'model-a': { kind: 'repeated', flag: '--image-references' }, 'model-b': { kind: 'repeated', flag: '--image-references' }, 'model-c': { kind: 'repeated', flag: '--image-references' } },
  });

  expect(plan.commands[1]).toMatchObject({
    referenceReadiness: { kind: 'missing', missing: [{ what: 'product', required: 1, available: 0 }] },
  });
  expect(plan.commands[1].args).not.toContain('--image-references');
});

test('reuses a what that was established in an earlier non-identity beat', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [
      { ...scene.beats[0], checks: [{ kind: 'reference', what: 'person', count: 1 }] },
      { ...scene.beats[1], checks: [{ kind: 'reference', what: 'product', count: 1 }] },
      { ...scene.beats[2], checks: [{ kind: 'reference', what: 'product', count: 1 }, { kind: 'identity-check' }] },
    ],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person.png'], product: ['serum.png'] },
    referenceDelivery: { 'model-a': { kind: 'repeated', flag: '--image-references' }, 'model-b': { kind: 'repeated', flag: '--image-references' }, 'model-c': { kind: 'repeated', flag: '--image-references' } },
  });

  expect(plan.commands[2]).toMatchObject({ referenceReadiness: { kind: 'ready', assets: ['serum.png'] } });
  expect(plan.commands[2].args).toContain('serum.png');
  expect(plan.commands[2].args).not.toContain('person.png');
});

test('reports an identity-only beat without an established reference as non-blocking unresolved', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [{ ...scene.beats[0], checks: [{ kind: 'identity-check' }] }],
  }, { mode: 'quality', minGeneratableSeconds: 4 });

  expect(plan.commands[0]).toMatchObject({ referenceReadiness: { kind: 'identity-unresolved' } });
  expect(plan.commands[0].args).not.toContain('--image-references');
  expect(plan.blocked).toEqual([]);
});

test('keeps unknown pricing explicit instead of treating it as zero', () => {
  const withoutPrices = buildShootPlan(scene, { mode: 'quality', minGeneratableSeconds: 4 });
  expect(withoutPrices.totalEstimatedCredits).toBeUndefined();
  expect(withoutPrices.unpriced).toEqual([0, 1, 2, 3, 4]);
  expect(withoutPrices.commands.every((command) => command.estimatedCredits === undefined)).toBe(true);

  const partialPrices = buildShootPlan(scene, { mode: 'quality', minGeneratableSeconds: 4, creditsPerSecond: { 'model-a': 2, 'model-b': 3 } });
  expect(partialPrices.totalEstimatedCredits).toBeUndefined();
  expect(partialPrices.unpriced).toEqual([3, 4]);
});

test('names blocking reasons and emits no command for an empty prompt', () => {
  const blankPromptScene: SceneSpec = {
    ...scene,
    beats: [{ ...scene.beats[0], promptCore: ' ' }, ...scene.beats.slice(1)],
  };
  // ⛔ 초판은 여기서 `quick`(컷 상한 1)을 써서 «비트 단위»와 «계획 단위» 막힘을 «섞었다».
  //    이 시험이 묻는 것은 «비트 단위»이므로 상한이 넉넉한 모드로 가른다.
  const plan = buildShootPlan(blankPromptScene, { mode: 'quality', minGeneratableSeconds: 4 });

  expect(plan.commands).toHaveLength(4);
  expect(plan.blocked).toEqual(expect.arrayContaining(['empty-prompt:beat-1']));

  // ⊕ 그리고 «계획 단위»는 여전히 명령을 «하나도» 안 낸다
  const planLevel = buildShootPlan(blankPromptScene, { mode: 'quick', minGeneratableSeconds: 4 });
  expect(planLevel.commands).toEqual([]);
  expect(planLevel.blocked).toEqual(expect.arrayContaining(['mode-cut-limit-exceeded:quick:1']));
});

test('ignores an invalid global fallback when every beat has a model-specific duration rule', () => {
  const plan = buildShootPlan(scene, {
    mode: 'quality',
    minGeneratableSeconds: 0,
    durationRules: {
      'model-a': { minimumSeconds: 4 },
      'model-b': { minimumSeconds: 4 },
      'model-c': { allowedSeconds: [4, 8] },
    },
  });

  expect(plan.commands).toHaveLength(scene.beats.length);
  expect(plan.blocked).toEqual([]);
  expect(plan.commands[4]).toMatchObject({ durationSeconds: 4, trimToSeconds: 2 });
});

test('blocks an invalid generation minimum when a beat needs the global fallback and preserves every blocked beat as unpriced', () => {
  const plan = buildShootPlan(scene, { mode: 'quality', minGeneratableSeconds: 0 });

  expect(plan.commands).toEqual([]);
  expect(plan.blocked).toContain('invalid-min-generatable-seconds');
  expect(plan.unpriced).toEqual([0, 1, 2, 3, 4]);
  expect(plan.totalEstimatedCredits).toBeUndefined();
});

test('keeps an empty-prompt beat unpriced because no safe command can be formed', () => {
  const blankPromptScene: SceneSpec = {
    ...scene,
    beats: [{ ...scene.beats[0], promptCore: '' }, ...scene.beats.slice(1)],
  };
  const plan = buildShootPlan(blankPromptScene, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    creditsPerSecond: { 'model-a': 2, 'model-b': 3, 'model-c': 4 },
  });

  expect(plan.commands).toHaveLength(4);
  expect(plan.unpriced).toEqual([0]);
  expect(plan.totalEstimatedCredits).toBeUndefined();
});

// 🔴 회귀 가드 — 초판은 blocked 를 채우면서 commands 를 «그대로» 냈다.
//    ⇒ 「blocked 를 안 보고 commands 만 쓰는」 소비자가 과금한다. 그 «상태 자체»를 없앤다.
test('preserves an earlier identity when a later identity-only delivery updates another identity', () => {
  const plan = buildShootPlan({
    ...scene,
    beats: [
      { ...scene.beats[0], model: 'repeated-model', checks: [{ kind: 'reference', what: 'person', count: 1 }] },
      { ...scene.beats[1], model: 'repeated-model', checks: [{ kind: 'reference', what: 'product', count: 1 }] },
      { ...scene.beats[2], model: 'repeated-model', checks: [{ kind: 'identity-check' }] },
      { ...scene.beats[3], model: 'repeated-model', checks: [{ kind: 'reference', what: 'person', count: 1 }, { kind: 'identity-check' }] },
    ],
  }, {
    mode: 'quality',
    minGeneratableSeconds: 4,
    referenceAssets: { person: ['person.png'], product: ['serum.png'] },
    referenceDelivery: { 'repeated-model': { kind: 'repeated', flag: '--image-references' } },
  });

  expect(plan.commands[2].args).toContain('serum.png');
  expect(plan.commands[3]).toMatchObject({ referenceReadiness: { kind: 'ready', assets: ['person.png'] } });
  expect(plan.commands[3].args).toContain('person.png');
  expect(plan.commands[3].args).not.toContain('serum.png');
});

test('⛔ 막힘이 «두 종류»다 — 계획 단위는 명령 0, 비트 단위는 «나머지를 살린다»', () => {
  // ⓑ 계획 «단위» 막힘 → 명령을 «하나도» 내지 않는다.
  //    🩸 초판은 이때도 명령을 그대로 냈고, 그러면 blocked 를 안 보는 소비자가 «과금»한다.
  for (const plan of [
    buildShootPlan(scene, { mode: 'quick', minGeneratableSeconds: 4 }),   // 컷 상한 초과
    buildShootPlan(scene, { mode: 'quality', minGeneratableSeconds: 0 }), // 최소 길이 무효
  ]) {
    expect(plan.blocked.length).toBeGreaterThan(0);
    expect(plan.commands).toEqual([]);
    expect(plan.totalEstimatedCredits).toBeUndefined();
  }

  // ⓐ 비트 «단위» 막힘 → 그 비트만 빼고 «나머지는 낸다».
  //    🔑 부분 성공을 통째로 버리면 쓸 수 있었던 넷도 잃는다.
  const oneEmpty = { ...scene, beats: scene.beats.map((b, i) => (i === 1 ? { ...b, promptCore: '' } : b)) } as typeof scene;
  const partial = buildShootPlan(oneEmpty, { mode: 'quality', minGeneratableSeconds: 4 });
  expect(partial.blocked.join(' ')).toContain('empty-prompt');
  expect(partial.commands).toHaveLength(scene.beats.length - 1);
  expect(partial.commands.some((c) => c.beatIndex === 1)).toBe(false);
});
