import { describe, test, expect } from 'bun:test';
import { resolveTextInputControlAction } from './input-control-key.js';

// ⛔ 이 시험은 «키 판정»만 본다 — state 는 그 분기에 쓰이지 않는다.
//   2026-08-19 에 시그니처가 2인자가 됐는데 여기가 «안 따라갔고», bun test 는 타입-블라인드라
//   4일 동안 초록으로 보였다(tsc 전수에서만 6건으로 잡혔다).
const EMPTY_STATE = { currentLine: '', cursor: 0 };


// ⛔⭐ 코드 리더 이전(2026-08-19 · 대표 지시) — `Ctrl+B` 를 «백그라운드 승격»에 내주고
//   접두는 `Ctrl+X` 로 옮겼다. 이 계약이 되돌아가면 두 기능이 «같은 키»를 다툰다.
describe('코드 리더 = Ctrl+X (Ctrl+B 는 백그라운드 승격으로 비웠다)', () => {
  test('⭐ Ctrl+X / Ctrl+ㅌ 가 코드를 «건다»', () => {
    expect(resolveTextInputControlAction({ name: 'x', ctrl: true } as never, EMPTY_STATE).kind).toBe('arm-chord');
    expect(resolveTextInputControlAction({ name: 'ㅌ', ctrl: true } as never, EMPTY_STATE).kind).toBe('arm-chord');
  });

  test('⛔ Ctrl+B 는 더 이상 코드를 «걸지 않는다» — 그 키는 백그라운드 승격의 것이다', () => {
    expect(resolveTextInputControlAction({ name: 'b', ctrl: true } as never, EMPTY_STATE).kind).not.toBe('arm-chord');
    expect(resolveTextInputControlAction({ name: 'ㅠ', ctrl: true } as never, EMPTY_STATE).kind).not.toBe('arm-chord');
  });

  test('기존 ctrl 키들은 그대로다 (회귀)', () => {
    expect(resolveTextInputControlAction({ name: 's', ctrl: true } as never, EMPTY_STATE).kind).toBe('save');
    expect(resolveTextInputControlAction({ name: 'm', ctrl: true } as never, EMPTY_STATE).kind).toBe('goto-pane');
  });
});
