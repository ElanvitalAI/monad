export type JsErasureState = 'erased' | 'intact' | 'unmeasured';

export interface JsErasureMeasurement {
  readonly visibleTextLength: number | null;
  readonly documentHeight: number | null;
}

export interface JsErasureMeasurements {
  readonly live: JsErasureMeasurement;
  readonly archiveScriptsEnabled: JsErasureMeasurement;
  readonly archiveScriptsDisabled: JsErasureMeasurement;
}

export interface JsErasureThresholds {
  readonly minimumTextGain: number;
  readonly minimumTextGainRatio: number;
  readonly minimumHeightGain: number;
  readonly minimumHeightGainRatio: number;
}

export interface JsErasureVerdict {
  readonly state: JsErasureState;
  readonly textGain: number | null;
  readonly textGainRatio: number | null;
  readonly heightGain: number | null;
  readonly heightGainRatio: number | null;
}

/**
 * A 20% relative gain and at least 100 visible characters or 100 pixels keeps
 * small layout drift from looking like erasure while detecting the observed
 * 730 → 6,622-character loss. Either text or height can demonstrate erasure.
 */
export const DEFAULT_JS_ERASURE_THRESHOLDS: JsErasureThresholds = {
  minimumTextGain: 100,
  minimumTextGainRatio: 0.2,
  minimumHeightGain: 100,
  minimumHeightGainRatio: 0.2,
};

function gain(disabled: number, enabled: number): { amount: number; ratio: number | null } {
  return {
    amount: disabled - enabled,
    // A ratio has no finite meaning when the enabled document is empty.
    ratio: enabled === 0 ? null : (disabled - enabled) / enabled,
  };
}

/** Pure comparison of supplied measurements; it neither opens nor controls a browser. */
export function judgeJsErasure(
  measurements: JsErasureMeasurements,
  thresholds: JsErasureThresholds = DEFAULT_JS_ERASURE_THRESHOLDS,
): JsErasureVerdict {
  // ⛔ 「둘 중 «하나»면 지움을 보인다」고 적어 놓고 «여섯이 다 있어야» 판정하면 그 문장이 거짓이 된다.
  //    🩸 실물(2026-09-09): 높이 축이 「창을 쟀다」로 정직하게 내려가자, ***글자 축이 멀쩡한데도***
  //    전체가 `unmeasured` 가 됐다(129자 ↔ 2자를 손에 쥐고 「못 쟀다」고 말했다).
  //    ⇒ 축마다 «쓸 수 있나»를 따로 묻고, 하나라도 쓸 수 있으면 판정한다.
  //    ⭐ 라이브 값은 «표시용 비율»에만 쓰이므로 판정을 막지 않는다.
  const usable = (a: number | null, b: number | null): boolean => a !== null && b !== null;
  const textUsable = usable(measurements.archiveScriptsDisabled.visibleTextLength, measurements.archiveScriptsEnabled.visibleTextLength);
  const heightUsable = usable(measurements.archiveScriptsDisabled.documentHeight, measurements.archiveScriptsEnabled.documentHeight);
  if (!textUsable && !heightUsable) {
    return { state: 'unmeasured', textGain: null, textGainRatio: null, heightGain: null, heightGainRatio: null };
  }

  const text = textUsable
    ? gain(measurements.archiveScriptsDisabled.visibleTextLength!, measurements.archiveScriptsEnabled.visibleTextLength!)
    : null;
  const height = heightUsable
    ? gain(measurements.archiveScriptsDisabled.documentHeight!, measurements.archiveScriptsEnabled.documentHeight!)
    : null;
  const erased =
    (text !== null && text.amount >= thresholds.minimumTextGain && text.ratio !== null && text.ratio >= thresholds.minimumTextGainRatio) ||
    (height !== null && height.amount >= thresholds.minimumHeightGain && height.ratio !== null && height.ratio >= thresholds.minimumHeightGainRatio);
  return {
    state: erased ? 'erased' : 'intact',
    textGain: text?.amount ?? null,
    textGainRatio: text?.ratio ?? null,
    heightGain: height?.amount ?? null,
    heightGainRatio: height?.ratio ?? null,
  };
}
