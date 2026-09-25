// TUI 부활 T0 — dashboard.uiMode 해석 우선순위 회귀 고정.
// PLAN-tui-revival-essentials-2026-07-12 §3a / 대표 확정 ④(기본 essential).

import { describe, expect, test } from 'bun:test';
import { resolveDashboardUiMode } from '../src/views/ui-mode.js';

describe('resolveDashboardUiMode', () => {
  test('아무 입력 없음 → essential (기본값 플립 · 대표 확정 ④)', () => {
    expect(resolveDashboardUiMode({})).toBe('essential');
  });

  test('CLI --rich 가 최우선 — config essential 을 이긴다', () => {
    expect(resolveDashboardUiMode({ cliRich: true, configUiMode: 'essential' })).toBe('rich');
    expect(resolveDashboardUiMode({ cliRich: true })).toBe('rich');
  });

  test('config uiMode 명시가 레거시 defaultMode 를 이긴다', () => {
    expect(resolveDashboardUiMode({ configUiMode: 'rich', legacyDefaultMode: 'chat' })).toBe('rich');
    expect(resolveDashboardUiMode({ configUiMode: 'essential', legacyDefaultMode: 'dashboard' })).toBe('essential');
  });

  test('레거시 defaultMode 매핑 — dashboard→rich · chat→essential', () => {
    expect(resolveDashboardUiMode({ legacyDefaultMode: 'dashboard' })).toBe('rich');
    expect(resolveDashboardUiMode({ legacyDefaultMode: 'chat' })).toBe('essential');
  });

  test('cliRich=false 는 강제 아님 — config 그대로', () => {
    expect(resolveDashboardUiMode({ cliRich: false, configUiMode: 'rich' })).toBe('rich');
    expect(resolveDashboardUiMode({ cliRich: false })).toBe('essential');
  });
});
