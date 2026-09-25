import { describe, expect, test } from 'bun:test';

import { judgeJsErasure, type JsErasureMeasurements } from './js-erasure-verdict.js';

function measurements(
  live: number,
  enabled: number,
  disabled: number,
  heights: readonly [number, number, number] = [1000, 1000, 1000],
): JsErasureMeasurements {
  return {
    live: { visibleTextLength: live, documentHeight: heights[0] },
    archiveScriptsEnabled: { visibleTextLength: enabled, documentHeight: heights[1] },
    archiveScriptsDisabled: { visibleTextLength: disabled, documentHeight: heights[2] },
  };
}

describe('judgeJsErasure', () => {
  test('detects the observed archive text erasure sample with identical heights', () => {
    const verdict = judgeJsErasure(measurements(6617, 730, 6622));

    expect(verdict.state).toBe('erased');
    expect(verdict.textGain).toBe(5892);
    expect(verdict.heightGain).toBe(0);
  });

  test.each([
    [5986, 5986, 5986],
    [2161, 2084, 2084],
  ])('keeps matching sample %d/%d/%d intact', (live, enabled, disabled) => {
    expect(judgeJsErasure(measurements(live, enabled, disabled)).state).toBe('intact');
  });

  // ⛔ 계약: 「글자와 높이 «둘 중 하나»면 지움을 보인다」. 그러니 한 축이 비어도 판정한다.
  //    🩸 실물(2026-09-09): 높이 축이 「창을 쟀다」로 정직하게 내려가자 ***글자 축이 멀쩡한데도***
  //    전체가 unmeasured 가 됐다. 옛 시험이 그 «틀린» 동작을 지키고 있었다.
  test('한 축이 비어도 «남은 축»으로 판정한다 — 높이가 없고 글자만 있을 때', () => {
    const sample = measurements(6617, 730, 6622);
    const verdict = judgeJsErasure({
      ...sample,
      archiveScriptsEnabled: { visibleTextLength: 730, documentHeight: null },
      archiveScriptsDisabled: { visibleTextLength: 6622, documentHeight: null },
    });

    expect(verdict.state).toBe('erased');
    expect(verdict.textGain).toBe(5892);
    expect(verdict.heightGain).toBeNull();
  });

  test('한 축이 비어도 «남은 축»으로 판정한다 — 글자가 없고 높이만 있을 때', () => {
    const sample = measurements(6617, 730, 6622);
    const verdict = judgeJsErasure({
      ...sample,
      archiveScriptsEnabled: { visibleTextLength: null, documentHeight: 1000 },
      archiveScriptsDisabled: { visibleTextLength: null, documentHeight: 9000 },
    });

    expect(verdict.state).toBe('erased');
    expect(verdict.textGain).toBeNull();
    expect(verdict.heightGain).toBe(8000);
  });

  test('⛔ «두 축이 다» 비면 그때만 못 쟀다고 말한다', () => {
    const sample = measurements(6617, 730, 6622);
    const verdict = judgeJsErasure({
      ...sample,
      archiveScriptsEnabled: { visibleTextLength: null, documentHeight: null },
      archiveScriptsDisabled: { visibleTextLength: null, documentHeight: null },
    });

    expect(verdict.state).toBe('unmeasured');
    expect(verdict.textGain).toBeNull();
    expect(verdict.heightGain).toBeNull();
  });

  test('preserves an undefined zero-baseline gain ratio as null', () => {
    const verdict = judgeJsErasure(measurements(10, 0, 200));

    expect(verdict.textGain).toBe(200);
    expect(verdict.textGainRatio).toBeNull();
    expect(verdict.state).toBe('intact');
  });
});
