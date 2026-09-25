import { expect, test } from 'bun:test';
import { CAPTION_LINE_MAX_CHARS, CAPTION_LINE_MIN_CHARS, CAPTION_MAX_LINES, buildCaptionPlan } from '../src/ad-pipeline/caption-plan.js';
import type { SceneSpec } from '../src/ad-pipeline/scene-spec.js';

const scene: SceneSpec = {
  beats: [
    { role: 'hook', startSec: 0, endSec: 5, emotion: { primary: 'calm', secondary: 'bright' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'first', checks: [] },
    { role: 'buildup', startSec: 5, endSec: 10, emotion: { primary: 'hope', secondary: 'warmth' }, camera: { move: 'pan', shotSize: 'medium' }, model: 'model', audio: true, promptCore: 'second', checks: [] },
  ],
  axes: { hook: 'hook', totalSeconds: 10, lock: { lens: '50mm', lighting: 'soft', grade: 'neutral', texture: 'clean' } },
  aspectRatio: '9:16',
  forbidden: [],
  provenance: 'generated',
};

function alignment(text: string, step = 0.1) {
  return {
    characters: [...text],
    character_start_times_seconds: [...text].map((_, index) => index * step),
    character_end_times_seconds: [...text].map((_, index) => (index + 1) * step),
  };
}

test('groups supplied aligned words and shifts each line onto the beat master timeline', () => {
  const plan = buildCaptionPlan(scene, [{ beatIndex: 1, alignment: alignment('capture every bright moment') }]);

  expect(plan.blocked).toEqual([]);
  expect(plan.captions).toEqual([{
    beatIndex: 1,
    lines: [{ text: 'capture every', startMs: 5000, endMs: 6300 }, { text: 'bright moment', startMs: 6400, endMs: 7700 }],
  }]);
});

test('keeps every caption within qc caption-lines limits', () => {
  const plan = buildCaptionPlan(scene, [{ beatIndex: 0, alignment: alignment('fresh flavors shine brightly') }]);
  const lines = plan.captions.flatMap((caption) => caption.lines);

  expect(plan.blocked).toEqual([]);
  expect(CAPTION_LINE_MIN_CHARS).toBe(12);
  expect(CAPTION_LINE_MAX_CHARS).toBe(16);
  expect(CAPTION_MAX_LINES).toBe(2);
  expect(lines).toHaveLength(2);
  expect(lines.every((line) => line.text.length >= CAPTION_LINE_MIN_CHARS && line.text.length <= CAPTION_LINE_MAX_CHARS)).toBe(true);
});

test('splits 19- and 22-character dialogue into an acceptable dense first line and short trailing line', () => {
  const plan = buildCaptionPlan(scene, [
    { beatIndex: 0, alignment: alignment('abcdefghijkl abcdef') },
    { beatIndex: 1, alignment: alignment('abcdefghijkl abcdefghi') },
  ]);

  expect(plan.blocked).toEqual([]);
  expect(plan.captions.map((caption) => caption.lines.map((line) => line.text))).toEqual([
    ['abcdefghijkl', 'abcdef'],
    ['abcdefghijkl', 'abcdefghi'],
  ]);
  expect(plan.captions.map((caption) => caption.lines.map((line) => line.text.length))).toEqual([
    [12, 6],
    [12, 9],
  ]);
});

test('blocks dialogue without usable alignment instead of inventing timestamps', () => {
  const plan = buildCaptionPlan(scene, [
    { beatIndex: 0 },
    { beatIndex: 1, alignment: { characters: ['bad'], character_start_times_seconds: [0], character_end_times_seconds: [] } },
  ]);

  expect(plan.captions).toEqual([]);
  expect(plan.blocked).toEqual(['missing-usable-alignment:beat-1', 'missing-usable-alignment:beat-2']);
});

test('finds a valid non-greedy word boundary when two caption lines fit', () => {
  const plan = buildCaptionPlan(scene, [{ beatIndex: 0, alignment: alignment('abcdefghijkl abc defghijkl') }]);

  expect(plan.blocked).toEqual([]);
  expect(plan.captions[0]!.lines.map((line) => line.text)).toEqual(['abcdefghijkl', 'abc defghijkl']);
  expect(plan.captions[0]!.lines.map((line) => line.text.length)).toEqual([12, 13]);
});

test('blocks unusable negative or time-reversed character alignment without emitting captions', () => {
  const negative = alignment('capture every');
  const reversed = alignment('capture every');
  negative.character_start_times_seconds[0] = -0.1;
  reversed.character_start_times_seconds[4] = 0.1;

  const plan = buildCaptionPlan(scene, [
    { beatIndex: 0, alignment: negative },
    { beatIndex: 1, alignment: reversed },
  ]);

  expect(plan.captions).toEqual([]);
  expect(plan.blocked).toEqual(['missing-usable-alignment:beat-1', 'missing-usable-alignment:beat-2']);
});

test('blocks dialogue that cannot satisfy the established caption line limits', () => {
  const plan = buildCaptionPlan(scene, [{ beatIndex: 0, alignment: alignment('this singlewordistoolong') }]);

  expect(plan.captions).toEqual([]);
  expect(plan.blocked).toEqual(['caption-line-limits-exceeded:beat-1']);
});
