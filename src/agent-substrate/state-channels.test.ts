// 공용 채널 reducer 프리미티브(C1 승격) — 제네릭 코어(schema 파라미터화) 검증.
import { test, expect, describe } from 'bun:test';
import {
  reduceChannel,
  applyChannelUpdate,
  applyChannelUpdates,
  effectiveLastNumber,
  type ChannelReducers,
} from './state-channels.js';

// 하니스가 자기 채널 스키마를 정의하는 예시(미션 무관).
const HARNESS_REDUCERS: ChannelReducers = {
  plan: 'lastValue',
  changes: 'append',
  decisions: 'append',
  verdict: 'lastValue',
};

describe('state-channels — reduceChannel(순수)', () => {
  test('lastValue — 새 값으로 덮어씀', () => {
    expect(reduceChannel('lastValue', { a: 1 }, { b: 2 })).toEqual({ b: 2 });
    expect(reduceChannel('lastValue', 5, undefined)).toBeUndefined();
  });
  test('append — 스칼라·배열 누적', () => {
    expect(reduceChannel('append', undefined, 'x')).toEqual(['x']);
    expect(reduceChannel('append', ['x'], 'y')).toEqual(['x', 'y']);
    expect(reduceChannel('append', ['x'], ['y', 'z'])).toEqual(['x', 'y', 'z']);
  });
  test('append — null/undefined 는 이력을 덮지 않음(손실 방지)', () => {
    expect(reduceChannel('append', ['x'], undefined)).toEqual(['x']);
    expect(reduceChannel('append', ['x'], null)).toEqual(['x']);
  });
});

describe('state-channels — applyChannelUpdate(schema 파라미터화)', () => {
  test('임의 스키마로 append/lastValue 분기', () => {
    let s = applyChannelUpdate({}, 'changes', 'edit-1', HARNESS_REDUCERS);
    s = applyChannelUpdate(s, 'changes', 'edit-2', HARNESS_REDUCERS);
    expect(s.changes).toEqual(['edit-1', 'edit-2']);   // append
    s = applyChannelUpdate(s, 'plan', { v: 1 }, HARNESS_REDUCERS);
    s = applyChannelUpdate(s, 'plan', { v: 2 }, HARNESS_REDUCERS);
    expect(s.plan).toEqual({ v: 2 });                   // lastValue
  });
  test('알 수 없는 채널은 lastValue(보수적)', () => {
    expect(applyChannelUpdate({}, 'unknown', 1, HARNESS_REDUCERS).unknown).toBe(1);
  });
  test('applyChannelUpdates — 배치 fold', () => {
    const s = applyChannelUpdates({}, [
      { channel: 'decisions', value: 'a' },
      { channel: 'verdict', value: 'pass' },
      { channel: 'decisions', value: 'b' },
    ], HARNESS_REDUCERS);
    expect(s.decisions).toEqual(['a', 'b']);
    expect(s.verdict).toBe('pass');
  });
});

describe('state-channels — effectiveLastNumber(손실차단 일반형)', () => {
  test('append 이력에서 마지막 non-null 유한수', () => {
    let s = applyChannelUpdate({}, 'changes', 5, HARNESS_REDUCERS);
    expect(effectiveLastNumber(s, 'changes')).toBe(5);
    s = applyChannelUpdate(s, 'changes', undefined, HARNESS_REDUCERS); // 빈 값
    expect(effectiveLastNumber(s, 'changes')).toBe(5);                 // 유지
    s = applyChannelUpdate(s, 'changes', 2, HARNESS_REDUCERS);
    expect(effectiveLastNumber(s, 'changes')).toBe(2);                 // 마지막 non-null
  });
  test('이력 없으면 undefined', () => {
    expect(effectiveLastNumber({}, 'changes')).toBeUndefined();
  });
});
