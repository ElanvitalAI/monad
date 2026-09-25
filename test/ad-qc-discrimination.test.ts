import { describe, expect, it } from 'bun:test';
import { assessQc, type QcMeasurements, type QcThresholds } from '../src/ad-pipeline/qc.js';

// 🔬 «판별 검사» — 🅕 가 2026-09-10 에 자기 자를 이것으로 무효화했다(무작위 잡음의 80% 에 라벨을 붙이고 있었다).
//
// ⛔⭐ 「시험이 초록」과 「자가 «구별»한다」는 다른 값이다.
//    자가 «모든 입력에 같은 답»을 내면 그것은 자가 아니라 상수다.
//    ⇒ 이 파일은 ***한 축씩만 흔들어*** 판정이 «그 축에 따라 갈리는지»만 묻는다.

const THRESHOLDS: QcThresholds = { dialogueLufsTolerance: 1, colorDistance: 0.2, frameDiffVariance: 0.1 };
const COMPLETE_THRESHOLDS: QcThresholds = { ...THRESHOLDS, durationRanges: { master: { minimumSeconds: 30, maximumSeconds: 30 } } };

/** 잰 축이 «전부 기준 안»인 바탕. ⛔ 사람 축은 여전히 unmeasured 라 verdict 는 ok 가 «아니다». */
const CLEAN = {
  audioPeakDb: -2, dialogueLufs: -14, duckingDb: -8,
  captionLines: [{ chars: 14 }], captionBottomPercent: 25,
  safeAreaViolations: [], aspectRatio: '9:16', resolution: '1080x1920',
  colorDistanceBetweenCuts: [0.05], colorDistanceWithinCuts: [0.05, 0.04], frameDiffVariance: 0.01, renderedContentPresent: true, detectedTextRegions: 0,
} as unknown as QcMeasurements;
const COMPLETE_CLEAN = { ...CLEAN, durationSeconds: 30, durationScope: 'master', negativePromptPresent: true } as QcMeasurements;

describe('🔬 qc 판별 검사 — 자가 «구별»하나', () => {
  it('⛔ 바탕은 «ok 가 아니다» — 사람 축이 안 잰 채 남아 있다', () => {
    const result = assessQc(CLEAN, THRESHOLDS);

    expect(result.verdict).toBe('unmeasured');
    expect(result.findings.find((finding) => finding.name === 'audio-peak')).toEqual({ name: 'audio-peak', verdict: 'ok' });
  });

  it('미측정 축은 각 조건의 케밥-케이스 사유를 남기고, 측정된 finding에는 사유를 붙이지 않는다', () => {
    const findingFor = (measurements: QcMeasurements, thresholds: QcThresholds, name: string) =>
      assessQc(measurements, thresholds).findings.find((finding) => finding.name === name);
    const withoutDialogueLufs = { ...CLEAN } as Record<string, unknown>;
    delete withoutDialogueLufs.dialogueLufs;
    const withoutDetectedTextRegions = { ...CLEAN } as Record<string, unknown>;
    delete withoutDetectedTextRegions.detectedTextRegions;

    expect(findingFor(withoutDialogueLufs as QcMeasurements, THRESHOLDS, 'dialogue-loudness')).toEqual({ name: 'dialogue-loudness', verdict: 'unmeasured', reason: 'no-dialogue-lufs' });
    expect(findingFor(CLEAN, { ...THRESHOLDS, dialogueLufsTolerance: undefined }, 'dialogue-loudness')).toEqual({ name: 'dialogue-loudness', verdict: 'unmeasured', reason: 'no-dialogue-lufs-tolerance' });
    expect(findingFor(withoutDetectedTextRegions as QcMeasurements, THRESHOLDS, 'unexpected-text')).toEqual({ name: 'unexpected-text', verdict: 'unmeasured', reason: 'no-detected-text-regions' });

    const reasons = [
      findingFor({ ...CLEAN, captionLines: undefined } as QcMeasurements, THRESHOLDS, 'caption-lines'),
      findingFor({ ...CLEAN, safeAreaViolations: undefined } as QcMeasurements, THRESHOLDS, 'safe-area'),
      findingFor({ ...CLEAN, aspectRatio: undefined, resolution: undefined } as QcMeasurements, THRESHOLDS, 'aspect-ratio'),
      findingFor({ ...CLEAN, resolution: undefined } as QcMeasurements, THRESHOLDS, 'resolution'),
      findingFor({ ...CLEAN, colorDistanceBetweenCuts: undefined } as QcMeasurements, THRESHOLDS, 'color-distance-between-cuts'),
      findingFor({ ...CLEAN, frameDiffVariance: undefined } as QcMeasurements, THRESHOLDS, 'frame-diff-variance'),
      findingFor({ ...CLEAN, frameDiffVariance: 0, renderedContentPresent: undefined } as QcMeasurements, THRESHOLDS, 'rendered-content-presence'),
      findingFor({ ...CLEAN, durationSeconds: undefined, durationScope: 'master' } as QcMeasurements, THRESHOLDS, 'duration-master'),
      findingFor({ ...CLEAN, negativePromptPresent: undefined } as QcMeasurements, THRESHOLDS, 'negative-prompt'),
    ];
    expect(reasons.map((finding) => finding?.reason)).toEqual([
      'no-caption-lines-measurement', 'no-safe-area-violations', 'no-aspect-ratio', 'no-resolution',
      'no-color-distance-between-cuts', 'no-frame-diff-variance', 'no-rendered-content-presence',
      'no-duration-seconds', 'no-negative-prompt-presence',
    ]);
    expect(new Set(reasons.map((finding) => finding?.reason)).size).toBe(9);
    expect(findingFor(CLEAN, THRESHOLDS, 'audio-peak')).toEqual({ name: 'audio-peak', verdict: 'ok' });
  });

  it('완전한 측정 입력은 사람 검토 사유를 남기고, 측정된 ok/regenerate finding에는 사유를 붙이지 않는다', () => {
    const result = assessQc(COMPLETE_CLEAN, COMPLETE_THRESHOLDS);
    const unmeasured = result.findings.filter((finding) => finding.verdict === 'unmeasured');
    const measured = result.findings.filter((finding) => finding.verdict !== 'unmeasured');
    const numericReasons = [
      ['audio-peak', { ...CLEAN, audioPeakDb: undefined }],
      ['ducking', { ...CLEAN, duckingDb: undefined }],
      ['caption-bottom-percent', { ...CLEAN, captionBottomPercent: undefined }],
    ].map(([name, measurements]) => assessQc(measurements as QcMeasurements, THRESHOLDS)
      .findings.find((finding) => finding.name === name)?.reason);

    expect(unmeasured.map((finding) => finding.name)).toEqual([
      'finger-distortion', 'face-morphing', 'background-distortion', 'identity-consistency',
    ]);
    expect(unmeasured.map((finding) => finding.reason)).toEqual([
      'manual-review-required', 'manual-review-required', 'manual-review-required', 'manual-review-required',
    ]);
    expect(unmeasured.every((finding) => finding.reason?.trim())).toBe(true);
    expect(numericReasons).toEqual(['no-audio-peak', 'no-ducking', 'no-caption-bottom-percent']);
    expect(new Set(numericReasons).size).toBe(3);
    expect(unmeasured.every((finding) => !numericReasons.includes(finding.reason))).toBe(true);
    expect(assessQc({}, {}).findings
      .filter((finding) => finding.verdict === 'unmeasured')
      .every((finding) => finding.reason?.trim())).toBe(true);
    expect(result.findings.filter((finding) => !['finger-distortion', 'face-morphing', 'background-distortion', 'identity-consistency'].includes(finding.name))).not.toContainEqual(expect.objectContaining({ verdict: 'unmeasured' }));
    expect(measured.every((finding) => !('reason' in finding))).toBe(true);
  });

  it('⭐ 한 축씩 흔들면 판정이 «그 축에 따라» 갈린다 — 같은 답만 내면 자가 아니다', () => {
    const verdictWhen = (patch: Partial<QcMeasurements>): string =>
      assessQc({ ...CLEAN, ...patch } as QcMeasurements, THRESHOLDS).verdict;

    // 색·톤 «만» 밖 → 재생성이 아니라 편집에서 고친다
    expect(verdictWhen({ colorDistanceBetweenCuts: [0.9] } as Partial<QcMeasurements>)).toBe('grade-fix');
    // 오디오 «만» 밖 → 다시 만들어야 한다
    expect(verdictWhen({ audioPeakDb: -0.2 } as Partial<QcMeasurements>)).toBe('regenerate');
    // 플리커 «만» 밖 → 다시 만들어야 한다
    expect(verdictWhen({ frameDiffVariance: 0.9 } as Partial<QcMeasurements>)).toBe('regenerate');
    // 둘이 동시에 → «비싼 쪽»이 이긴다
    expect(verdictWhen({ colorDistanceBetweenCuts: [0.9], audioPeakDb: -0.2 } as Partial<QcMeasurements>)).toBe('regenerate');
  });

  it('⛔ 서로 다른 «세 입력»이 서로 다른 답을 낸다 — 상수가 아니다', () => {
    const verdicts = new Set([
      assessQc(CLEAN, THRESHOLDS).verdict,
      assessQc({ ...CLEAN, colorDistanceBetweenCuts: [0.9] } as QcMeasurements, THRESHOLDS).verdict,
      assessQc({ ...CLEAN, audioPeakDb: -0.2 } as QcMeasurements, THRESHOLDS).verdict,
    ]);
    // 🔑 이 시험이 이 파일의 핵심이다 — 자가 «셋을 갈라» 보는지.
    expect(verdictWhenSizeAtLeast(verdicts, 3)).toBe(true);
  });

  it('같은 30초도 주입된 대상별 범위로 마스터는 통과하고 컷은 경고한다', () => {
    const master = assessQc(
      { ...CLEAN, durationSeconds: 30, durationScope: 'master' } as QcMeasurements,
      { ...THRESHOLDS, durationRanges: { master: { minimumSeconds: 30, maximumSeconds: 30 } } },
    );
    const cut = assessQc(
      { ...CLEAN, durationSeconds: 30, durationScope: 'cut' } as QcMeasurements,
      { ...THRESHOLDS, durationRanges: { cut: { minimumSeconds: 3, maximumSeconds: 8 } } },
    );

    // 🔑 #17505 뒤 「통과」는 «침묵»이 아니라 이름이다 — 그래야 「쟀는데 통과」와 「못 쟀다」가 갈린다.
    expect(master.findings).toContainEqual({ name: 'duration-master', verdict: 'ok' });
    expect(cut.findings).toContainEqual({ name: 'duration-cut', verdict: 'warn' });
  });

  it('주입된 길이 범위가 없으면 범위별 길이를 unmeasured로 남긴다', () => {
    const result = assessQc({ ...CLEAN, durationSeconds: 30, durationScope: 'master' } as QcMeasurements, THRESHOLDS);

    expect(result.findings).toContainEqual({ name: 'duration-master', verdict: 'unmeasured', reason: 'no-duration-range' });
  });

  it('길이 대상이 미상인 측정은 컷으로 단정하지 않고 unmeasured로 남긴다', () => {
    const result = assessQc({ ...CLEAN, durationSeconds: 30 } as QcMeasurements, THRESHOLDS);

    expect(result.findings).toContainEqual({ name: 'duration-unscoped', verdict: 'unmeasured', reason: 'no-duration-scope' });
    expect(result.findings).not.toContainEqual(expect.objectContaining({ name: 'duration-cut' }));
  });

  it('정적 프레임은 rendered-content-presence로 측정 누락·의도한 정지·빈 화면을 구별한다', () => {
    const findingFor = (measurements: QcMeasurements) =>
      assessQc(measurements, THRESHOLDS).findings.find((finding) => finding.name === 'rendered-content-presence');
    const staticFrame = { ...CLEAN, frameDiffVariance: 0 } as QcMeasurements;
    const { renderedContentPresent: _present, ...withoutRenderedContentMeasurement } = staticFrame;
    const missing = findingFor(withoutRenderedContentMeasurement);
    const present = findingFor({ ...staticFrame, renderedContentPresent: true });
    const absent = findingFor({ ...staticFrame, renderedContentPresent: false });

    expect(missing).toEqual({ name: 'rendered-content-presence', verdict: 'unmeasured', reason: 'no-rendered-content-presence' });
    // 🔑 rendered-content-presence 를 «떼어낸» 뒤: variance 는 잴 수 있었고 임계 안이므로 그 축의 답은 났다.
    expect(assessQc(withoutRenderedContentMeasurement, THRESHOLDS).findings).toContainEqual({ name: 'frame-diff-variance', verdict: 'ok' });
    // 🔑 #17505 뒤 「의도한 정지」도 «이름»을 갖는다 — 아래 셋 갈림(size 3)은 그대로 성립한다.
    expect(present).toEqual({ name: 'rendered-content-presence', verdict: 'ok' });
    expect(absent).toEqual({ name: 'rendered-content-presence', verdict: 'regenerate' });
    expect(new Set([missing?.verdict, present?.verdict ?? 'ok', absent?.verdict]).size).toBe(3);
    expect(findingFor({ ...withoutRenderedContentMeasurement, frameDiffVariance: 0.01 } as QcMeasurements)).toEqual({ name: 'rendered-content-presence', verdict: 'unmeasured', reason: 'no-rendered-content-presence' });
  });

  it('컷 내부 색 거리는 얼어붙은 프레임·움직임·혼합·부재를 구별하고 이웃 판정을 보존한다', () => {
    const findingFor = (colorDistanceWithinCuts: readonly number[] | undefined) => {
      const result = assessQc({ ...CLEAN, colorDistanceWithinCuts } as QcMeasurements, THRESHOLDS);
      return result.findings.find((finding) => finding.name === 'color-distance-within-cuts');
    };

    expect(findingFor([0, 0])).toEqual({ name: 'color-distance-within-cuts', verdict: 'regenerate' });
    expect(findingFor([0.05, 0.04])).toEqual({ name: 'color-distance-within-cuts', verdict: 'ok' });
    expect(findingFor([0, 0.05])).toEqual({ name: 'color-distance-within-cuts', verdict: 'ok' });
    expect(findingFor(undefined)).toEqual({ name: 'color-distance-within-cuts', verdict: 'unmeasured', reason: 'no-color-distance-within-cuts' });
    expect(findingFor([])).toEqual({ name: 'color-distance-within-cuts', verdict: 'unmeasured', reason: 'no-color-distance-within-cuts' });

    const neighbors = assessQc({ ...CLEAN, colorDistanceWithinCuts: [0, 0] } as QcMeasurements, THRESHOLDS).findings;
    expect(neighbors).toContainEqual({ name: 'color-distance-between-cuts', verdict: 'ok' });
    expect(neighbors).toContainEqual({ name: 'frame-diff-variance', verdict: 'ok' });
  });

  it('직접 호출의 저분산 누락은 frame-diff-variance 소견으로도 드러난다', () => {
    const findings = assessQc({ frameDiffVariance: 0 }, { frameDiffVariance: 100 }).findings;

    expect(findings).toContainEqual({ name: 'frame-diff-variance', verdict: 'ok' });
    expect(findings).toContainEqual({ name: 'rendered-content-presence', verdict: 'unmeasured', reason: 'no-rendered-content-presence' });
  });

  it('높은 frame-diff-variance 플리커는 rendered content와 무관하게 재생성한다', () => {
    const result = assessQc({ ...CLEAN, frameDiffVariance: 0.9, renderedContentPresent: true } as QcMeasurements, THRESHOLDS);

    expect(result.findings).toContainEqual({ name: 'frame-diff-variance', verdict: 'regenerate' });
    // 🔑 제목이 말하는 「무관하게」를 «부재»가 아니라 «독립»으로 단언한다 — 플리커여도 렌더 내용은 제 답을 낸다.
    expect(result.findings).toContainEqual({ name: 'rendered-content-presence', verdict: 'ok' });
  });

  it('색 거리와 프레임 분산은 측정값 부재와 임계값 부재를 구별한다', () => {
    const colorMeasurementMissing = assessQc({ ...CLEAN, colorDistanceBetweenCuts: undefined } as QcMeasurements, THRESHOLDS);
    const colorThresholdMissing = assessQc(CLEAN, { ...THRESHOLDS, colorDistance: undefined });
    const varianceMeasurementMissing = assessQc({ ...CLEAN, frameDiffVariance: undefined } as QcMeasurements, THRESHOLDS);
    const varianceThresholdMissing = assessQc(CLEAN, { ...THRESHOLDS, frameDiffVariance: undefined });

    expect(colorMeasurementMissing.findings).toContainEqual({ name: 'color-distance-between-cuts', verdict: 'unmeasured', reason: 'no-color-distance-between-cuts' });
    expect(colorThresholdMissing.findings).toContainEqual({ name: 'color-distance-between-cuts', verdict: 'unmeasured', reason: 'no-color-distance-threshold' });
    expect(varianceMeasurementMissing.findings).toContainEqual({ name: 'frame-diff-variance', verdict: 'unmeasured', reason: 'no-frame-diff-variance' });
    expect(varianceThresholdMissing.findings).toContainEqual({ name: 'frame-diff-variance', verdict: 'unmeasured', reason: 'no-frame-diff-variance-threshold' });
  });
});

function verdictWhenSizeAtLeast(set: ReadonlySet<string>, n: number): boolean {
  return set.size >= n;
}
