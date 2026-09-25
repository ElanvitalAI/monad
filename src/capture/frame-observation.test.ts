// frame-observation — S4 P1 화면-상태 관측(순수·개입 없음). 시간 인자 주입이라 시계 조작 불필요.

import { describe, test, expect } from 'bun:test';
import { observeFrame, finalizeFrameObservation, INITIAL_FRAME_OBSERVATION, STALL_RUNGS_MS, type FrameObservationState } from './frame-observation.js';

/** 샘플 시퀀스를 순차 적용해 발생한 관측 이벤트만 모은다. */
function run(samples: Array<{ state: Parameters<typeof observeFrame>[1]['state']; screen: string; atMs: number }>) {
  let st: FrameObservationState = INITIAL_FRAME_OBSERVATION;
  const transitions: Array<{ from: string | null; to: string; heldMs: number }> = [];
  const stalls: Array<{ state: string; sameScreenMs: number; rung: number }> = [];
  for (const s of samples) {
    const o = observeFrame(st, s);
    st = o.next;
    if (o.transition) transitions.push({ from: o.transition.from, to: o.transition.to, heldMs: o.transition.heldMs });
    if (o.stall) stalls.push({ state: o.stall.state, sameScreenMs: o.stall.sameScreenMs, rung: o.stall.rung });
  }
  return { st, transitions, stalls };
}

describe('observeFrame — 상태 전이 관측', () => {
  test('첫 샘플은 전이 1건(from=null·heldMs 0)', () => {
    const { transitions } = run([{ state: 'working', screen: 'a', atMs: 1000 }]);
    expect(transitions).toEqual([{ from: null, to: 'working', heldMs: 0 }]);
  });

  test('같은 상태 연속이면 전이 없음(로그 폭주 방지)', () => {
    const { transitions } = run([
      { state: 'working', screen: 'a', atMs: 1000 },
      { state: 'working', screen: 'b', atMs: 2500 },
      { state: 'working', screen: 'c', atMs: 4000 },
    ]);
    expect(transitions.length).toBe(1); // 첫 진입만
  });

  test('전이 시 직전 상태 유지시간(heldMs) 기록', () => {
    const { transitions } = run([
      { state: 'working', screen: 'a', atMs: 1000 },
      { state: 'working', screen: 'b', atMs: 3000 },
      { state: 'blocked', screen: 'c', atMs: 6000 },
    ]);
    expect(transitions[1]).toEqual({ from: 'working', to: 'blocked', heldMs: 5000 });
  });

  test('왕복 전이도 각각 기록(working→blocked→working)', () => {
    const { transitions } = run([
      { state: 'working', screen: 'a', atMs: 0 },
      { state: 'blocked', screen: 'b', atMs: 1500 },
      { state: 'working', screen: 'c', atMs: 3000 },
    ]);
    expect(transitions.map((t) => `${t.from}->${t.to}`)).toEqual(['null->working', 'working->blocked', 'blocked->working']);
  });
});

describe('observeFrame — stall(화면 무변화) 관측', () => {
  const [R0, R1, R2] = STALL_RUNGS_MS as [number, number, number];

  test('화면이 계속 바뀌면 stall 없음', () => {
    const { stalls } = run([
      { state: 'working', screen: 'a', atMs: 0 },
      { state: 'working', screen: 'b', atMs: 20_000 },
      { state: 'working', screen: 'c', atMs: 40_000 },
    ]);
    expect(stalls).toEqual([]);
  });

  test('동일 화면이 첫 사다리를 넘으면 stall 1건', () => {
    const { stalls } = run([
      { state: 'working', screen: 'same', atMs: 0 },
      { state: 'working', screen: 'same', atMs: R0 - 1 },   // 아직 문턱 미달
      { state: 'working', screen: 'same', atMs: R0 + 500 }, // 문턱 통과
    ]);
    expect(stalls.length).toBe(1);
    expect(stalls[0]!.rung).toBe(0);
    expect(stalls[0]!.sameScreenMs).toBeGreaterThanOrEqual(R0);
  });

  test('★ 같은 사다리를 재기록하지 않는다(문턱 통과 시 1회만)', () => {
    const { stalls } = run([
      { state: 'working', screen: 'same', atMs: 0 },
      { state: 'working', screen: 'same', atMs: R0 + 1 },
      { state: 'working', screen: 'same', atMs: R0 + 2000 },
      { state: 'working', screen: 'same', atMs: R0 + 5000 },
    ]);
    expect(stalls.length).toBe(1);
  });

  test('사다리를 더 넘으면 그 단계마다 1건(0→1→2)', () => {
    const { stalls } = run([
      { state: 'unknown', screen: 'same', atMs: 0 },
      { state: 'unknown', screen: 'same', atMs: R0 + 1 },
      { state: 'unknown', screen: 'same', atMs: R1 + 1 },
      { state: 'unknown', screen: 'same', atMs: R2 + 1 },
    ]);
    expect(stalls.map((s) => s.rung)).toEqual([0, 1, 2]);
  });

  test('화면이 바뀌면 사다리 리셋 — 이후 다시 처음부터', () => {
    const { stalls } = run([
      { state: 'working', screen: 'same', atMs: 0 },
      { state: 'working', screen: 'same', atMs: R0 + 1 },              // rung 0
      { state: 'working', screen: 'same', atMs: R1 + 1 },              // rung 1
      { state: 'working', screen: 'moved', atMs: R1 + 2000 },          // 진행 → 리셋
      { state: 'working', screen: 'moved', atMs: R1 + 2000 + R0 + 1 }, // 다시 rung 0
    ]);
    expect(stalls.map((s) => s.rung)).toEqual([0, 1, 0]);
  });

  test('샘플이 드물면 중간 사다리를 건너뛰고 도달한 최상위 1건만 낸다(폭주 방지·의도된 동작)', () => {
    const { stalls } = run([
      { state: 'unknown', screen: 'same', atMs: 0 },
      { state: 'unknown', screen: 'same', atMs: R1 + 1 }, // 0 을 건너뛰고 1
    ]);
    expect(stalls.map((s) => s.rung)).toEqual([1]);
  });

  test('⭐ 상태와 stall 은 직교 — working 이어도 화면이 멈추면 stall(P0-③ 핵심: blocked 로는 hang 을 못 잡는다)', () => {
    const { stalls } = run([
      { state: 'working', screen: 'spinnerless', atMs: 0 },
      { state: 'working', screen: 'spinnerless', atMs: R1 + 1 },
    ]);
    expect(stalls.length).toBeGreaterThan(0);
    expect(stalls.every((s) => s.state === 'working')).toBe(true);
  });

  test('⭐ blocked(명시 프롬프트) 와 stall 은 함께 날 수 있다 — 두 트리거가 별개 신호', () => {
    const { transitions, stalls } = run([
      { state: 'blocked', screen: 'do you want to proceed?', atMs: 0 },
      { state: 'blocked', screen: 'do you want to proceed?', atMs: R0 + 1 },
    ]);
    expect(transitions.length).toBe(1);            // null->blocked
    expect(stalls.length).toBe(1);                 // 응답 없이 멈춰 있음
    expect(stalls[0]!.state).toBe('blocked');
  });
});

describe('observeFrame — 순수성·상태 캐리', () => {
  test('입력 상태를 변형하지 않는다(순수)', () => {
    const prev = INITIAL_FRAME_OBSERVATION;
    observeFrame(prev, { state: 'working', screen: 'a', atMs: 100 });
    expect(prev).toEqual(INITIAL_FRAME_OBSERVATION);
  });

  test('같은 입력 → 같은 출력(결정론)', () => {
    const prev = INITIAL_FRAME_OBSERVATION;
    const a = observeFrame(prev, { state: 'idle', screen: 's', atMs: 7 });
    const b = observeFrame(prev, { state: 'idle', screen: 's', atMs: 7 });
    expect(a).toEqual(b);
  });
});

// ⭐ 리뷰 must-fix — 시각 0 에서 시작한 run. 종전엔 stateSinceMs 를 truthy sentinel 로 써서
//   `0 || atMs` 가 시작 시각을 현재로 덮어써 이후 heldMs 가 전부 틀렸다(0 은 유효 시각이다).
describe('observeFrame — atMs=0 시작 회귀', () => {
  test('★ 0 에서 시작해도 heldMs 가 정확하다', () => {
    const { transitions } = run([
      { state: 'working', screen: 'a', atMs: 0 },
      { state: 'working', screen: 'b', atMs: 1500 },
      { state: 'blocked', screen: 'c', atMs: 3000 },
    ]);
    // working 은 0 부터 3000 까지 유지 → heldMs 3000 (종전 버그면 1500)
    expect(transitions[1]).toEqual({ from: 'working', to: 'blocked', heldMs: 3000 });
  });

  test('★ 0 에서 시작한 동일 화면의 stall 경과도 정확하다', () => {
    const R0 = STALL_RUNGS_MS[0]!;
    const { stalls } = run([
      { state: 'unknown', screen: 'same', atMs: 0 },
      { state: 'unknown', screen: 'same', atMs: R0 },
    ]);
    expect(stalls.length).toBe(1);
    expect(stalls[0]!.sameScreenMs).toBe(R0);
  });
});

// ⭐ 리뷰 should-fix — 종료 관측(우측 절단 해소). observeFrame 은 전이 시점에만 heldMs 를 내므로
//   run 의 마지막 상태는 지속시간이 기록되지 않는다. P2 가 볼 분포에서 "마지막에 오래 멈춘 채 끝난"
//   케이스가 빠지는 것을 막는다.
describe('finalizeFrameObservation — 종료 시 마지막 상태 지속시간', () => {
  test('관측이 없으면 null', () => {
    expect(finalizeFrameObservation(INITIAL_FRAME_OBSERVATION, 1000)).toBeNull();
  });

  test('★ 마지막 상태의 heldMs 를 낸다(전이가 없어도)', () => {
    const { st } = run([
      { state: 'working', screen: 'a', atMs: 0 },
      { state: 'unknown', screen: 'b', atMs: 1000 },
    ]);
    // unknown 이 1000 부터 시작 → 종료 5000 이면 4000 유지
    expect(finalizeFrameObservation(st, 5000)).toEqual({ state: 'unknown', heldMs: 4000, sameScreenMs: 4000 });
  });

  test('★ 마지막 화면 정지 경과도 낸다(상태는 안 바뀌고 화면만 멈춘 종료)', () => {
    const { st } = run([
      { state: 'working', screen: 'frozen', atMs: 0 },
      { state: 'working', screen: 'frozen', atMs: 2000 },
    ]);
    const fin = finalizeFrameObservation(st, 90_000);
    expect(fin).toEqual({ state: 'working', heldMs: 90_000, sameScreenMs: 90_000 });
  });

  test('종료 시각이 시작보다 이르면 0 으로 클램프(시계 역행 방어)', () => {
    const { st } = run([{ state: 'idle', screen: 'x', atMs: 5000 }]);
    expect(finalizeFrameObservation(st, 1000)).toEqual({ state: 'idle', heldMs: 0, sameScreenMs: 0 });
  });
});
