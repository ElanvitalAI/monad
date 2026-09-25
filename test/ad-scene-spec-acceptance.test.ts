import { describe, expect, it } from 'bun:test';
import { validateSceneSpec, type SceneSpec } from '../src/ad-pipeline/scene-spec.js';

// 🎬 RFC 수용 시험 — `RFC-higgsfield-marketing-pipeline-upgrade-three-modes-2026-09-10.md` §수용 시험.
//
// ⛔⭐ 이 파일은 「코드에 그 낱말이 있나」를 «안 묻는다». 대표 이 준 검증 시나리오가
//    ***손실 없이 왕복하고, 거절되어야 할 것이 «실제로» 거절되나***만 묻는다.
// 🩸 이 시나리오가 RFC 초안을 반증했다 — 초안은 beats 를 «3칸 고정 튜플»로 뒀고
//    이 표(5비트)를 «표현할 수 없었다». 그래서 이것이 이 축의 반증 대상이다.
// ⛔ 이 시험을 지우거나 시나리오를 줄이지 마라 — 줄이면 그 반증력이 사라진다.

/** 대표 검증 시나리오 〈비 오는 날의 우산〉 — 30초 숏폼 5비트 */
const rainyUmbrella: SceneSpec = {
  aspectRatio: '9:16',
  provenance: 'generated',
  forbidden: [],
  axes: {
    hook: '비 내리는 골목, 우산 없이 젖는 여자',
    totalSeconds: 30,
    lock: { lens: '85mm', lighting: 'warm streetlight backlight', grade: 'cinematic teal', texture: 'rain', identity: { kind: 'hero-frame', ref: '인물 ref 1장' } },
  },
  beats: [
    { role: 'hook', startSec: 0, endSec: 5, emotion: { primary: '외로움', secondary: '차가움' },
      camera: { move: 'static', shotSize: 'close-up' }, model: 'seedance_2_0', audio: false,
      promptCore: 'Young woman in rainy alley, soaked hair, melancholic close-up, cinematic teal grade, shallow DOF',
      checks: [{ kind: 'reference', what: '인물 정면', count: 1 }] },
    { role: 'buildup', startSec: 5, endSec: 12, emotion: { primary: '기대', secondary: '망설임' },
      camera: { move: 'dolly-in', shotSize: 'wide' }, model: 'kling3_0', audio: false,
      promptCore: 'Man approaching with umbrella, slow dolly-in, rainy night street, warm streetlight backlight',
      checks: [{ kind: 'identity-check' }],
      transitionIn: { kind: 'hard-cut', intent: '고립된 훅에서 접근의 시작으로 리듬을 빠르게 넘긴다' } },
    { role: 'buildup', startSec: 12, endSec: 20, emotion: { primary: '떨림', secondary: '설렘' },
      camera: { move: 'static', shotSize: 'medium' }, model: 'kling3_0', audio: true,
      promptCore: 'Two people in rain, slow umbrella tilt protecting her, ambient rain sound, intimate framing',
      checks: [{ kind: 'bgm-enter' }],
      transitionIn: { kind: 'match-cut', intent: '남자의 접근 동선을 우산 동작으로 이어 감정의 연결감을 만든다' } },
    { role: 'climax', startSec: 20, endSec: 28, emotion: { primary: '정서 정점', secondary: '해소' },
      camera: { move: 'push-in', shotSize: 'close-up' }, model: 'seedance_2_0', audio: false,
      promptCore: 'Woman lifting gaze slowly, raindrops on lashes, emotional reveal, soft warm key light',
      checks: [{ kind: 'static-impact' }],
      transitionIn: { kind: 'hold', intent: '빗소리와 침묵을 유지한 채 클로즈업으로 정서 정점을 만든다' } },
    { role: 'transition', startSec: 28, endSec: 30, emotion: { primary: '여운', secondary: '기대' },
      camera: { move: 'static', shotSize: 'wide' }, model: 'kling3_0', audio: false,
      promptCore: 'Two silhouettes walking under one umbrella, wide pull-back, rain-soaked street, fade-out',
      checks: [{ kind: 'end-card', text: '다음 편에 계속' }],
      transitionIn: { kind: 'dissolve', intent: '감정의 여운을 남기며 실루엣과 텍스트로 마무리한다' } },
  ],
};

describe('대표 검증 시나리오 〈비 오는 날의 우산〉 — 30초 5비트', () => {
  it('⛔ 통과한다 — 거절되면 설계가 틀린 것이다', () => {
    const r = validateSceneSpec(rainyUmbrella);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it('⭐ 8초·2초 구간은 «경고»이지 «거절»이 아니다 (팁 ≠ 불변식)', () => {
    const r = validateSceneSpec(rainyUmbrella);
    // 시나리오 자신이 권장 5~7초를 «안 지킨다» — 그것이 팁을 불변식으로 만들면 안 되는 증거다.
    expect(r.valid).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.join(' ')).toContain('5');
  });

  it('⛔ 거절되어야 하는 넷이 «실제로» 거절된다 — 통과하면 불변식이 장식이다', () => {
    const mutate = (fn: (s: SceneSpec) => SceneSpec): ReturnType<typeof validateSceneSpec> =>
      validateSceneSpec(fn(structuredClone(rainyUmbrella) as SceneSpec));

    // ⓐ 감정이 하나면 — 실패 모드 1번이 「감정이 떠 있음」이다
    expect(mutate((s) => { (s.beats[0].emotion as { secondary: string }).secondary = ''; return s; }).valid).toBe(false);
    // ⓑ 구간 합이 totalSeconds 와 다르면 — 「대충 30초」가 편집에서 «잘림»으로 나타난다
    expect(mutate((s) => { (s.beats[4] as { endSec: number }).endSec = 29; return s; }).valid).toBe(false);
    // ⓒ 모델 enum 밖 비율 — 교재의 트레일러 설정 넷이 이 값을 쓰는데 «생성에도 배포에도» 없다
    expect(mutate((s) => ({ ...s, aspectRatio: '2.39:1' as never })).valid).toBe(false);
    // ⓓ 비트가 셋 미만
    expect(mutate((s) => ({ ...s, beats: s.beats.slice(0, 2), axes: { ...s.axes, totalSeconds: 12 } })).valid).toBe(false);
  });

  it('⭐ 왕복이 «무손실»이다 — 씬 구조표의 다섯 칸이 하나도 안 사라진다', () => {
    const round = JSON.parse(JSON.stringify(rainyUmbrella)) as SceneSpec;
    expect(round).toEqual(rainyUmbrella);
    // 비트마다 «다른» 모델 — 정체성·정서는 Seedance, 모션·오디오는 Kling (교재 2단계)
    expect(new Set(round.beats.map((b) => b.model)).size).toBeGreaterThan(1);
    // audio 는 «비트 3만» — 빗소리가 그 비트의 «내용»이다
    expect(round.beats.filter((b) => b.audio)).toHaveLength(1);
    expect(round.beats.findIndex((b) => b.audio)).toBe(2);
    // 전환 넷이 intent 와 «함께» 산다 (부록 C ⓑ)
    const transitions = round.beats.map((b) => b.transitionIn).filter(Boolean);
    expect(transitions.map((t) => t!.kind)).toEqual(['hard-cut', 'match-cut', 'hold', 'dissolve']);
    expect(transitions.every((t) => t!.intent.trim().length > 0)).toBe(true);
    // 비고는 «태그»다 — 자유 문자열이 아니다 (교재 작성 팁 ④)
    expect(round.beats.flatMap((b) => b.checks).map((c) => c.kind))
      .toEqual(['reference', 'identity-check', 'bgm-enter', 'static-impact', 'end-card']);
  });
});
