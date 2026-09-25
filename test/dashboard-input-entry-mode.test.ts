import { describe, expect, test } from 'bun:test';

import {
  buildDashboardInputInitialText,
  resolveDashboardInputEntryMode,
  CHAT_MAIN_AUTO_ENTRY_KEY_NAME,
} from '../src/dashboard/input/entry-mode.js';

describe('dashboard input entry mode', () => {
  test('plain slash enters quick slash mode', () => {
    expect(resolveDashboardInputEntryMode({ name: '/', ctrl: false, shift: false } as never)).toBe('slash');
  });

  test('ctrl+l 은 더 이상 입력 진입이 아니다 — force-redraw 로 재정의(2026-07-12)', () => {
    expect(resolveDashboardInputEntryMode({ name: 'l', ctrl: true, shift: false } as never)).toBeNull();
    expect(resolveDashboardInputEntryMode({ name: 'ㅣ', ctrl: true, shift: false } as never)).toBeNull();
  });

  // 회귀 가드(2026-07-12 무한 깜빡임): essential 자동 진입은 합성 Ctrl+L 이 아니라
  // 전용 센티널 — Ctrl+L=force-redraw 재정의와 충돌해 busy-loop 이 됐던 사고.
  test('자동 진입 센티널 → plain 진입', () => {
    expect(resolveDashboardInputEntryMode({ name: CHAT_MAIN_AUTO_ENTRY_KEY_NAME, ctrl: false, shift: false } as never)).toBe('plain');
  });

  test('quick slash mode prefixes the pending text with slash', () => {
    expect(buildDashboardInputInitialText('slash', '')).toBe('/');
    expect(buildDashboardInputInitialText('slash', 'file-attach:/tmp/demo')).toBe('/file-attach:/tmp/demo');
  });

  test('plain input mode keeps the pending prefix as-is', () => {
    expect(buildDashboardInputInitialText('plain', '')).toBeUndefined();
    expect(buildDashboardInputInitialText('plain', 'hello')).toBe('hello');
  });
});
