// 「내가 «잰» 사실」과 「사람이 «말한» 사실」이 갈려 있는가.
//
// 🩸 왜 — RFC §4 의 접합점: 오버레이 조건이 읽는 사실 중 `found_footage`(소재 디렉토리가 있나)는
//   ***`plan` 이 원리상 못 잰다.*** 그 칸을 채우는 것은 사람의 한 마디뿐이다.
//   ⛔ 그런데 받아서 «섞으면» 산출을 읽는 사람이 「도구가 쟀다」와 「내가 그렇게 말했다」를 구분할 수 없고,
//     ***틀린 말을 도구의 실측으로 읽는다.*** 그래서 이 자는 「받나」가 아니라 ***「갈려 있나」***를 문다.
import { describe, expect, it } from 'bun:test';
import { overlayState, type PickedForOverlay } from './overlay-state.js';

const PICKED: PickedForOverlay[] = [
  { cap: 'app-control', tier: 'metered' },
  { cap: 'tts', tier: 'free' },
  { cap: 'video-gen', tier: null },   // ⛔ 안 고른 칸 — live 에서 빠져야 한다
];

describe('overlayState — 잰 것과 «말해 준» 것', () => {
  it('⭐ 말해 주지 «않으면» 그 키는 상태에 «없다» — 0 이 아니다', () => {
    const r = overlayState(PICKED);
    expect('found_footage' in r.state).toBe(false);   // ⛔ 「없다」와 「0」은 다른 값이다
    expect(r.told).toEqual([]);
  });

  it('⭐ 못 재는 키는 받되 «told» 로 갈린다 — measured 에 섞이지 않는다', () => {
    const r = overlayState(PICKED, { found_footage: 1 });
    expect(r.state.found_footage).toBe(1);
    expect(r.told).toEqual(['found_footage']);
    expect(r.measured).not.toContain('found_footage');
    // 자가 무는지 — measured 가 비면 위 단언이 공허하게 참이다
    expect(r.measured.length).toBeGreaterThan(0);
  });

  it('⛔ 도구가 «재는» 키는 말로 못 덮는다 — 거부하고 «이유»를 낸다', () => {
    const r = overlayState(PICKED, { selected_app_control: 99 });
    expect(r.state.selected_app_control).toBe(1);     // 잰 값 그대로(app-control 1개)
    expect(r.told).toEqual([]);
    expect(r.refused.map((x) => x.key)).toEqual(['selected_app_control']);
    // ⛔ 조용히 버리면 「반영됐다」로 읽힌다 — 이유가 «값으로» 있어야 한다
    expect(r.refused[0]!.why.length).toBeGreaterThan(0);
  });

  it('⛔ 수가 아니면 거부한다 — 조건 엔진은 비교만 안다', () => {
    const r = overlayState(PICKED, { weird: Number.NaN });
    expect('weird' in r.state).toBe(false);
    expect(r.refused.map((x) => x.key)).toEqual(['weird']);
  });

  it('⭐ 안 고른 칸(tier=null)은 사실에서 «빠진다»', () => {
    const r = overlayState([{ cap: 'app-control', tier: null }]);
    expect(r.state.selected_app_control).toBe(0);
  });
});
