import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseMeasuredModelContracts } from '../src/ad-pipeline/model-contracts.js';
import { buildShootPlan } from '../src/ad-pipeline/shoot-plan.js';
import type { SceneSpec } from '../src/ad-pipeline/scene-spec.js';

const measuredJson = readFileSync(new URL('../docs/ad-presets/higgsfield-measured-contracts.json', import.meta.url), 'utf8');

function contractsFrom(json: string) {
  const result = parseMeasuredModelContracts(json);
  if ('error' in result) throw new Error(result.error);
  return result;
}

test('parses the measured preset while excluding underscore-prefixed metadata', () => {
  const contracts = contractsFrom(measuredJson);

  expect(contracts.durationRules).toEqual({
    seedance_2_0: { minimumSeconds: 4 },
    kling3_0_turbo: { minimumSeconds: 3 },
  });
  expect(contracts.creditsPerSecond).toEqual({ seedance_2_0: 4.5, kling3_0_turbo: 1.5 });
  expect(contracts.referenceDelivery).toEqual({
    seedance_2_0: { kind: 'repeated', flag: '--image-references' },
  });
  expect(Object.keys(contracts.durationRules)).not.toContain('_evidence');
  expect(Object.keys(contracts.creditsPerSecond)).not.toContain('_evidence');
  expect(Object.keys(contracts.referenceDelivery)).not.toContain('_evidence');
});

test('exposes axis-specific unknown models without silently supplying defaults', () => {
  const contracts = contractsFrom(measuredJson);

  expect(contracts.unknown).toEqual(['kling3_0_turbo']);
  expect(contracts.referenceDelivery.kling3_0_turbo).toBeUndefined();
});

test('returns readable errors instead of throwing for malformed JSON or invalid axis shapes', () => {
  expect(parseMeasuredModelContracts('{not JSON')).toMatchObject({ error: expect.stringContaining('invalid measured model contracts JSON') });
  expect(parseMeasuredModelContracts(JSON.stringify({ durationRules: [], creditsPerSecond: {}, referenceDelivery: {} })))
    .toEqual({ error: 'invalid durationRules: expected a contract axis object' });
  expect(parseMeasuredModelContracts(JSON.stringify({ durationRules: {}, creditsPerSecond: {}, referenceDelivery: {}, _unknown: [] })))
    .toEqual({ error: 'expected _unknown to be an object' });
});

test('omits invalid values per model while retaining valid contracts', () => {
  const contracts = contractsFrom(JSON.stringify({
    durationRules: { valid: { minimumSeconds: 4 }, invalid: { minimumSeconds: 'four' }, _evidence: 'metadata' },
    creditsPerSecond: { valid: 1.5, invalid: -1, _evidence: 'metadata' },
    referenceDelivery: { valid: { kind: 'single', flag: '--start-image' }, invalid: { kind: 'other', flag: '--wrong' } },
  }));

  expect(contracts.durationRules).toEqual({ valid: { minimumSeconds: 4 } });
  expect(contracts.creditsPerSecond).toEqual({ valid: 1.5 });
  expect(contracts.referenceDelivery).toEqual({ valid: { kind: 'single', flag: '--start-image' } });
});

test('excludes only an axis declared unknown when that axis also has a value', () => {
  const contracts = contractsFrom(JSON.stringify({
    durationRules: { kling3_0_turbo: { minimumSeconds: 3 } },
    creditsPerSecond: { kling3_0_turbo: 1.5 },
    referenceDelivery: { kling3_0_turbo: { kind: 'repeated', flag: '--image-references' } },
    _unknown: { 'kling3_0_turbo.referenceDelivery': 'not measured' },
  }));

  expect(contracts.durationRules).toEqual({ kling3_0_turbo: { minimumSeconds: 3 } });
  expect(contracts.creditsPerSecond).toEqual({ kling3_0_turbo: 1.5 });
  expect(contracts.referenceDelivery.kling3_0_turbo).toBeUndefined();
  expect(contracts.unknown).toEqual(['kling3_0_turbo']);
});

test('accepts error as a model name instead of mistaking it for a parser error', () => {
  const contracts = contractsFrom(JSON.stringify({
    durationRules: {},
    creditsPerSecond: { error: 1.5 },
    referenceDelivery: {},
  }));

  expect(contracts.creditsPerSecond).toEqual({ error: 1.5 });
});

test('uses prototype-free maps so special model names preserve contracts and omissions', () => {
  const contracts = contractsFrom(JSON.stringify({
    durationRules: { constructor: { minimumSeconds: 4 } },
    creditsPerSecond: { toString: 1.5, invalid: -1 },
    referenceDelivery: { toString: { kind: 'single', flag: '--start-image' } },
    _unknown: {
      'constructor.referenceDelivery': 'not measured',
      'toString.durationRules': 'not measured',
    },
  }));

  expect(Object.getPrototypeOf(contracts.durationRules)).toBeNull();
  expect(Object.getPrototypeOf(contracts.creditsPerSecond)).toBeNull();
  expect(Object.getPrototypeOf(contracts.referenceDelivery)).toBeNull();
  const durations = contracts.durationRules as Readonly<Record<string, unknown>>;
  const credits = contracts.creditsPerSecond as Readonly<Record<string, unknown>>;
  const references = contracts.referenceDelivery as Readonly<Record<string, unknown>>;
  expect(durations['constructor']).toEqual({ minimumSeconds: 4 });
  expect(durations['toString']).toBeUndefined();
  expect(credits['toString']).toBe(1.5);
  expect(credits['constructor']).toBeUndefined();
  expect(credits['invalid']).toBeUndefined();
  expect(references['constructor']).toBeUndefined();
  expect(references['toString']).toEqual({ kind: 'single', flag: '--start-image' });
});

test('feeds directly into buildShootPlan and preserves the requested trim', () => {
  const contracts = contractsFrom(measuredJson);
  const scene: SceneSpec = {
    beats: [{ role: 'hook', startSec: 0, endSec: 3, emotion: { primary: 'calm', secondary: 'bright' }, camera: { move: 'static', shotSize: 'wide' }, model: 'seedance_2_0', audio: false, promptCore: 'Product shot', checks: [] }],
    axes: { hook: 'Product', totalSeconds: 3, lock: { lens: '50mm', lighting: 'soft', grade: 'neutral', texture: 'clean' } },
    aspectRatio: '9:16',
    forbidden: [],
    provenance: 'generated',
  };

  const plan = buildShootPlan(scene, { mode: 'quality', ...contracts });

  expect(plan.commands).toMatchObject([{ jobType: 'seedance_2_0', durationSeconds: 4, trimToSeconds: 3, estimatedCredits: 18 }]);
  expect(plan.unpriced).toEqual([]);
});
