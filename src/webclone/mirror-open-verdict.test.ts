import { describe, expect, test } from 'bun:test';

import {
  judgeMirrorOpen,
  BROWSER_SCROLL_HEIGHT_LIMIT,
  normalizeDocumentHeight,
  type MirrorOpenMeasurements,
} from './mirror-open-verdict.js';

const measured: MirrorOpenMeasurements = {
  documentHeight: 6413,
  bodyFontFamily: 'Inter, sans-serif',
  bodyBackground: 'rgb(255, 255, 255)',
  h1FontSize: '32px',
};

describe('normalizeDocumentHeight', () => {
  test('keeps a normal document height that differs from the window height', () => {
    expect(normalizeDocumentHeight({
      documentElementScrollHeight: 17447,
      bodyScrollHeight: 1171,
      innerHeight: 1171,
    })).toEqual({ documentHeight: 17447, exclusionReason: 'none' });
  });

  test('rejects the selected document height when it equals the window height', () => {
    expect(normalizeDocumentHeight({
      documentElementScrollHeight: 1171,
      bodyScrollHeight: 1171,
      innerHeight: 1171,
    })).toEqual({ documentHeight: null, exclusionReason: 'viewport-height' });
  });

  test('rejects a document height when the window height is zero', () => {
    expect(normalizeDocumentHeight({
      documentElementScrollHeight: 4_000_000,
      bodyScrollHeight: 0,
      innerHeight: 0,
    })).toEqual({ documentHeight: null, exclusionReason: 'missing-window' });
  });

  test('rejects the browser scroll-height limit', () => {
    expect(normalizeDocumentHeight({
      documentElementScrollHeight: 0,
      bodyScrollHeight: BROWSER_SCROLL_HEIGHT_LIMIT,
      innerHeight: 1171,
    })).toEqual({ documentHeight: null, exclusionReason: 'scroll-height-limit' });
  });

  test('leaves missing source readings unmeasured without an exclusion reason', () => {
    expect(normalizeDocumentHeight({
      documentElementScrollHeight: null,
      bodyScrollHeight: 17447,
      innerHeight: 1171,
    })).toEqual({ documentHeight: null, exclusionReason: 'none' });
  });
});

describe('judgeMirrorOpen', () => {
  test.each([
    ['all match', measured, 'open', 4],
    ['three match, one unmeasured', { ...measured, h1FontSize: null }, 'open', 3],
    ['one mismatch, three unmeasured', { documentHeight: 1, bodyFontFamily: null, bodyBackground: null, h1FontSize: null }, 'different', 1],
    ['all unmeasured', { documentHeight: null, bodyFontFamily: null, bodyBackground: null, h1FontSize: null }, 'unmeasured', 0],
  ] as const)('%s reports aggregate and observation counts', (_name, archive, state, observedAxisCount) => {
    expect(judgeMirrorOpen(measured, archive)).toMatchObject({ state, observedAxisCount, totalAxisCount: 4 });
  });
  test('preserves all four axes and applies mismatch then match precedence across all 81 combinations', () => {
    const states = ['match', 'mismatch', 'unmeasured'] as const;
    for (const documentHeight of states) {
      for (const bodyFontFamily of states) {
        for (const bodyBackground of states) {
          for (const h1FontSize of states) {
            const axes = { documentHeight, bodyFontFamily, bodyBackground, h1FontSize };
            const value = <T extends string | number>(state: typeof states[number], same: T, different: T): T | null =>
              state === 'unmeasured' ? null : state === 'match' ? same : different;
            const archive: MirrorOpenMeasurements = {
              documentHeight: value(documentHeight, 6413, 6414),
              bodyFontFamily: value(bodyFontFamily, 'Inter, sans-serif', 'serif'),
              bodyBackground: value(bodyBackground, 'rgb(255, 255, 255)', 'rgb(0, 0, 0)'),
              h1FontSize: value(h1FontSize, '32px', '33px'),
            };
            const values = Object.values(axes);
            const expected = values.some(state => state === 'mismatch') ? 'different'
              : values.every(state => state === 'unmeasured') ? 'unmeasured' : 'open';
            expect(judgeMirrorOpen(measured, archive)).toEqual({ state: expected, axes, observedAxisCount: values.filter(state => state !== 'unmeasured').length, totalAxisCount: 4 });
            expect(judgeMirrorOpen(archive, measured)).toEqual({ state: expected, axes, observedAxisCount: values.filter(state => state !== 'unmeasured').length, totalAxisCount: 4 });
          }
        }
      }
    }
  });

  test('opens when all four computed measurements match', () => {
    const verdict = judgeMirrorOpen(measured, { ...measured });

    expect(verdict.state).toBe('open');
    expect(verdict.axes).toEqual({
      documentHeight: 'match',
      bodyFontFamily: 'match',
      bodyBackground: 'match',
      h1FontSize: 'match',
    });
  });

  test('names document height as different when only height differs', () => {
    const verdict = judgeMirrorOpen(measured, { ...measured, documentHeight: 113527 });

    expect(verdict.state).toBe('different');
    expect(verdict.axes.documentHeight).toBe('mismatch');
    expect(verdict.axes.bodyFontFamily).toBe('match');
  });

  test('does not count a missing measurement as a match', () => {
    const verdict = judgeMirrorOpen(measured, { ...measured, h1FontSize: null });

    expect(verdict.state).toBe('open');
    expect(verdict.axes.h1FontSize).toBe('unmeasured');
  });

  test('leaves a rejected height unmeasured without masking a mismatch on another axis', () => {
    const verdict = judgeMirrorOpen(
      { ...measured, documentHeight: null },
      { ...measured, documentHeight: null, bodyBackground: 'rgb(0, 0, 0)' },
    );

    expect(verdict.axes.documentHeight).toBe('unmeasured');
    expect(verdict.axes.bodyBackground).toBe('mismatch');
    expect(verdict.state).toBe('different');
  });

  test('does not treat a viewport-rejected height on one side as matching or mismatching', () => {
    const rejected = normalizeDocumentHeight({
      documentElementScrollHeight: 1171,
      bodyScrollHeight: 1171,
      innerHeight: 1171,
    });
    const verdict = judgeMirrorOpen(
      { ...measured, documentHeight: rejected.documentHeight },
      measured,
    );

    expect(rejected.exclusionReason).toBe('viewport-height');
    expect(verdict.axes.documentHeight).toBe('unmeasured');
    expect(verdict.state).toBe('open');
  });

  test('leaves a rejected height unmeasured without converting matching axes into mismatches', () => {
    const verdict = judgeMirrorOpen(
      { ...measured, documentHeight: null },
      { ...measured, documentHeight: null },
    );

    expect(verdict.axes.documentHeight).toBe('unmeasured');
    expect(verdict.axes.bodyFontFamily).toBe('match');
    expect(verdict.axes.bodyBackground).toBe('match');
    expect(verdict.axes.h1FontSize).toBe('match');
    expect(verdict.state).toBe('open');
  });
});
