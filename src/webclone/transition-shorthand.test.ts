import { describe, expect, test } from 'bun:test';
import { parseAnimationNames, parseTransitionShorthand, splitTopLevel } from './transition-shorthand.js';

describe('splitTopLevel — 괄호 안의 쉼표는 «구분자가 아니다»', () => {
  test('cubic-bezier 의 쉼표 세 개를 «안 자른다»', () => {
    expect(splitTopLevel('color 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 1s', ',')).toEqual([
      'color 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      'transform 1s',
    ]);
  });

  test('공백 분할도 괄호를 존중한다', () => {
    expect(splitTopLevel('color 0.2s cubic-bezier(0.4, 0, 0.2, 1)', ' ')).toEqual([
      'color',
      '0.2s',
      'cubic-bezier(0.4, 0, 0.2, 1)',
    ]);
  });
});

describe('parseTransitionShorthand', () => {
  test('길이·곡선·대상을 «가른다»', () => {
    const parts = parseTransitionShorthand('color 0.2s cubic-bezier(0.4,0,0.2,1)');
    expect(parts.durations).toEqual(['0.2s']);
    expect(parts.easings).toEqual(['cubic-bezier(0.4,0,0.2,1)']);
    expect(parts.properties).toEqual(['color']);
  });

  test('⛔ 둘째 시간은 «지연»이지 길이가 아니다 — 길이로 세지 않는다', () => {
    const parts = parseTransitionShorthand('opacity 300ms 50ms ease-out');
    expect(parts.durations).toEqual(['300ms']);
    expect(parts.easings).toEqual(['ease-out']);
  });

  test('⛔ 곡선을 «안 적었으면» 사양 기본값 ease 를 «넣지 않는다» (추론은 관측이 아니다)', () => {
    expect(parseTransitionShorthand('opacity 300ms').easings).toEqual([]);
  });

  test('여러 칸을 각각 가른다', () => {
    const parts = parseTransitionShorthand('color 0.2s ease, transform 300ms linear');
    expect(parts.durations).toEqual(['0.2s', '300ms']);
    expect(parts.easings).toEqual(['ease', 'linear']);
    expect(parts.properties).toEqual(['color', 'transform']);
  });

  test('steps()·linear() 도 «곡선»으로 친다 — 이름이 아니라 «모양»으로', () => {
    expect(parseTransitionShorthand('all 1s steps(4, end)').easings).toEqual(['steps(4, end)']);
    expect(parseTransitionShorthand('all 1s linear(0, 0.5, 1)').easings).toEqual(['linear(0, 0.5, 1)']);
  });

  test('⛔ 안 풀린 var 는 «세어서» 낸다 — 조용히 0 이 되지 않는다', () => {
    const parts = parseTransitionShorthand('var(--nope), opacity 1s ease');
    expect(parts.unresolved).toBe(1);
    expect(parts.durations).toEqual(['1s']);
  });

  test('⛔ 빈 문자열은 «아무것도 만들지 않는다»', () => {
    expect(parseTransitionShorthand('')).toEqual({
      durations: [], easings: [], properties: [], unresolved: 0,
    });
  });
});

describe('parseAnimationNames — ⛔ 단축형에 var() 가 있으면 CSSOM 이 이름을 «안 준다»', () => {
  test('시간·곡선·키워드를 «빼고» 이름만 집는다', () => {
    expect(parseAnimationNames('notification-show 320ms cubic-bezier(0.2,0,0,1) both')).toEqual(['notification-show']);
    expect(parseAnimationNames('spin 1s linear infinite')).toEqual(['spin']);
  });

  test('칸마다 «하나»씩 — 여러 애니메이션', () => {
    expect(parseAnimationNames('a 1s, b 2s ease-out')).toEqual(['a', 'b']);
  });

  test('⛔ 반복 «횟수»를 이름으로 읽지 않는다', () => {
    expect(parseAnimationNames('pulse 1s 3 ease')).toEqual(['pulse']);
  });

  test('⛔ 안 풀린 var 가 있으면 «이름을 지어내지» 않는다', () => {
    expect(parseAnimationNames('var(--x) 1s')).toEqual([]);
  });

  test('⛔ 이름이 «없는» 문면에서 값을 만들지 않는다 (음성 대조군)', () => {
    expect(parseAnimationNames('1s 2s ease')).toEqual([]);
    expect(parseAnimationNames('none 1s')).toEqual([]);
    expect(parseAnimationNames('')).toEqual([]);
  });
});
