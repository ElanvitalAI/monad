// ⭐ A2(72차): 저작 100~110초 동안 그 런은 «아무 원장에도 없다» ⇒ 두 창이 서로를 못 본다.
//   71차에 두 트랙이 같은 파일을 칠 뻔했고 «채널 발신»으로만 막았다.
// ⛔ 처방은 원장에 «쓰기»가 아니라 이미 남는 관측을 «읽기»다(새 상태를 만들지 않는다).
import { describe, expect, test } from 'bun:test';
import {
  ASK_AUTHORING_BLIND_WINDOW_MS,
  classifyConcurrentAuthoring,
  renderConcurrentAuthoringNotice,
} from '../src/self-dev/launch-preflight.js';

const NOW = 1_786_440_000_000;
const minutesAgo = (n: number) => NOW - n * 60_000;

describe('classifyConcurrentAuthoring', () => {
  test('창 안에서 «겹치는» 경로만 고른다', () => {
    const overlaps = classifyConcurrentAuthoring(
      ['src/a.ts', 'src/b.ts'],
      [
        { atMs: minutesAgo(1), paths: ['src/b.ts', 'src/z.ts'] },
        { atMs: minutesAgo(2), paths: ['src/z.ts'] },
      ],
      NOW,
    );
    expect(overlaps).toEqual([{ atMs: minutesAgo(1), agoMinutes: 1, sharedPaths: ['src/b.ts'] }]);
  });

  test('최신 순으로 준다', () => {
    const overlaps = classifyConcurrentAuthoring(
      ['src/a.ts'],
      [{ atMs: minutesAgo(4), paths: ['src/a.ts'] }, { atMs: minutesAgo(1), paths: ['src/a.ts'] }],
      NOW,
    );
    expect(overlaps.map(({ agoMinutes }) => agoMinutes)).toEqual([1, 4]);
  });

  // ⛔ 창은 «저작 시간»에서 나온다 — 넓히면 「내 앞선 발사」가 매번 걸려 경고가 안 읽힌다(B1 의 병).
  test('창 «밖»은 안 센다', () => {
    const justOutside = NOW - ASK_AUTHORING_BLIND_WINDOW_MS - 1;
    expect(classifyConcurrentAuthoring(['src/a.ts'], [{ atMs: justOutside, paths: ['src/a.ts'] }], NOW)).toEqual([]);
    const justInside = NOW - ASK_AUTHORING_BLIND_WINDOW_MS;
    expect(classifyConcurrentAuthoring(['src/a.ts'], [{ atMs: justInside, paths: ['src/a.ts'] }], NOW)).toHaveLength(1);
  });

  test('«미래» 표본은 안 센다(시계 어긋남에 값을 만들지 않는다)', () => {
    expect(classifyConcurrentAuthoring(['src/a.ts'], [{ atMs: NOW + 1_000, paths: ['src/a.ts'] }], NOW)).toEqual([]);
  });

  test('내 경로가 없으면 «겹칠 것이 없다»', () => {
    expect(classifyConcurrentAuthoring([], [{ atMs: minutesAgo(1), paths: ['src/a.ts'] }], NOW)).toEqual([]);
  });

  test('같은 표본 안의 중복 경로를 두 번 세지 않는다', () => {
    const [overlap] = classifyConcurrentAuthoring(['src/a.ts'], [{ atMs: minutesAgo(1), paths: ['src/a.ts', 'src/a.ts'] }], NOW);
    expect(overlap?.sharedPaths).toEqual(['src/a.ts']);
  });
});

describe('renderConcurrentAuthoringNotice', () => {
  test('겹침이 없으면 «아무 말도 안 한다»', () => {
    expect(renderConcurrentAuthoringNotice([])).toBeNull();
  });

  // ⛔ 「수」가 아니라 «이름»을 준다 — 72차 B1: 수만 주면 사람이 그 줄을 안 읽는다.
  test('경로 이름과 경과 분을 «대면서» 도구가 못 가른다는 것도 말한다', () => {
    const notice = renderConcurrentAuthoringNotice([{ atMs: minutesAgo(2), agoMinutes: 2, sharedPaths: ['src/a.ts'] }]);
    expect(notice).toContain('src/a.ts');
    expect(notice).toContain('2분 전');
    expect(notice).toContain('도구는 그것을 못 가른다');
  });

  test('셋을 넘으면 앞의 셋만 이름을 대되 «총 건수»는 말한다', () => {
    const overlaps = [4, 3, 2, 1].map((n) => ({ atMs: minutesAgo(n), agoMinutes: n, sharedPaths: [`src/${n}.ts`] }));
    const notice = renderConcurrentAuthoringNotice(overlaps)!;
    expect(notice).toContain('4건');
    expect(notice.split('\n')).toHaveLength(4);
    expect(notice).not.toContain('src/1.ts');
  });
});
