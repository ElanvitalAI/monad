import { describe, expect, it } from 'bun:test';
import { groundedFilesNotMentionedInAskNarrative } from '../src/self-implement/goal-author.js';

/** ⭐ 접지 목록 상한 — ⛔ 「수」는 참값 그대로, 「목록」만 자른다.
 *
 *  🩸 실측 2026-09-08(🅣): 이 줄이 ***531,411자***가 된 골이 있었고 그것이 골 전체의 ***96%***였다
 *    (접지 파일 6,625개). 전수 N=3,253: 중앙값 2 · 75% 3 · 최대 6,625.
 *  🔑 이 저장소 저작 규율은 이미 *"근거 목록은 「수 ⊕ 재는 명령」으로"* 인데
 *    ***그 규율이 「기계가 골에 쓰는 것」에는 안 걸려 있었다.***
 *  ⛔ 가장 중요한 반증: ***`dev-pipeline` 의 소비자가 여전히 «참값»을 읽는가.*** */
const CONSUMER = /^\s*- Grounding files not mentioned in ask \((\d+)\):/u;

// ⛔ 렌더러를 «복제하지 않는다» — 실물을 부른다.
//   🩸 처음엔 같은 문자열을 시험 안에 다시 지었는데, 그러면 실물이 바뀌어도 «안 문다»
//     (이 저장소의 기록: *"지어낸 픽스처는 자를 «복제»한다 — 초록인데 미탐 100%"*).
const render = (n: number): string =>
  groundedFilesNotMentionedInAskNarrative(
    { files: Array.from({ length: n }, (_, i) => `src/f${i}.ts`) } as never,
    'ask 본문에는 그 경로들이 없다',
  )!;

describe('접지 목록 상한', () => {
  it('⛔⭐ 잘려도 «소비자가 읽는 수»는 참값이다 — 계측이 안 깨진다', () => {
    for (const n of [0, 1, 20, 21, 6625]) {
      expect(Number(CONSUMER.exec(render(n))![1])).toBe(n);
    }
  });

  it('⛔ 폭주가 «접힌다» — 6,625개가 한 줄을 덮지 않는다', () => {
    const big = render(6625);
    expect(big.length).toBeLessThan(2000);           // 종전엔 531,411자였다
    expect(big).toContain('외 6605개');
  });

  it('⛔ 반증 — 상한 «안»이면 «안 자른다»(항상 접는 자가 아니다)', () => {
    expect(render(20)).not.toContain('외 ');
    expect(render(21)).toContain('외 1개');
  });

  it('0건은 종전 문면 그대로 — 소비자가 0을 읽는다', () => {
    expect(Number(CONSUMER.exec(render(0))![1])).toBe(0);
  });
});
