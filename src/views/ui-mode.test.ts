// ── resolveDashboardUiMode 우선순위 (2026-07-17) ──────────────────────────
//
// shell-runner-boot P1(RFC §5)이 이 resolver 로 헤드리스 판정을 한다 —
// essential → RunShell VW 페인 스킵(헤드리스 캡처). 아래 불변식이 깨지면
// essential 사용자가 rich 로 오판정되어 안 뜨는 VW 를 그리려다 UX 가 샌다.

import { describe, it, expect } from 'bun:test';
import {
  isDashboardHeavyFeature,
  isDashboardHeavyFeatureEnabled,
  resolveDashboardUiMode,
  scratchImageSize,
  type DashboardUiMode,
} from './ui-mode.js';

describe('resolveDashboardUiMode — 우선순위', () => {
  it('전부 미설정 → essential (P1 헤드리스 기본)', () => {
    expect(resolveDashboardUiMode({})).toBe('essential');
  });

  it('config uiMode 명시가 그대로 (essential/rich)', () => {
    expect(resolveDashboardUiMode({ configUiMode: 'essential' })).toBe('essential');
    expect(resolveDashboardUiMode({ configUiMode: 'rich' })).toBe('rich');
  });

  it('CLI --rich 가 최우선 (config essential 이라도 rich)', () => {
    expect(resolveDashboardUiMode({ cliRich: true, configUiMode: 'essential' })).toBe('rich');
  });

  it('레거시 defaultMode 는 uiMode 미설정 시만 (dashboard→rich · chat→essential)', () => {
    expect(resolveDashboardUiMode({ legacyDefaultMode: 'dashboard' })).toBe('rich');
    expect(resolveDashboardUiMode({ legacyDefaultMode: 'chat' })).toBe('essential');
    // uiMode 명시가 레거시를 이긴다
    expect(resolveDashboardUiMode({ configUiMode: 'essential', legacyDefaultMode: 'dashboard' })).toBe('essential');
  });
});

describe('isDashboardHeavyFeatureEnabled — 모드별 무거운 기능 게이트', () => {
  it('rich 에서 알려진 기능은 전부 켜진다', () => {
    expect(isDashboardHeavyFeatureEnabled('rich', 'scratch-image')).toBe(true);
    expect(isDashboardHeavyFeatureEnabled('rich', 'scratch-file')).toBe(true);
    expect(isDashboardHeavyFeatureEnabled('rich', 'clipboard-preview-modal')).toBe(true);
    expect(isDashboardHeavyFeatureEnabled('rich', 'hover-popups')).toBe(true);
    expect(isDashboardHeavyFeatureEnabled('rich', 'hud')).toBe(true);
    expect(isDashboardHeavyFeatureEnabled('rich', 'dock')).toBe(true);
    expect(isDashboardHeavyFeatureEnabled('rich', 'workspace-frame')).toBe(true);
  });

  it('essential 에서 알려진 기능은 전부 꺼진다', () => {
    expect(isDashboardHeavyFeatureEnabled('essential', 'scratch-image')).toBe(false);
    expect(isDashboardHeavyFeatureEnabled('essential', 'scratch-file')).toBe(false);
    expect(isDashboardHeavyFeatureEnabled('essential', 'clipboard-preview-modal')).toBe(false);
    expect(isDashboardHeavyFeatureEnabled('essential', 'hover-popups')).toBe(false);
    expect(isDashboardHeavyFeatureEnabled('essential', 'hud')).toBe(false);
    expect(isDashboardHeavyFeatureEnabled('essential', 'dock')).toBe(false);
    expect(isDashboardHeavyFeatureEnabled('essential', 'workspace-frame')).toBe(false);
  });

  it('모르는 이름은 어느 모드에서도 꺼진다 (fail-closed)', () => {
    const unknown: string = 'unknown-heavy-feature';
    const enabledAtRuntime = (mode: DashboardUiMode, feature: string): boolean => {
      if (!isDashboardHeavyFeature(feature)) return false;
      return isDashboardHeavyFeatureEnabled(mode, feature);
    };
    expect(isDashboardHeavyFeature(unknown)).toBe(false);
    expect(enabledAtRuntime('rich', unknown)).toBe(false);
    expect(enabledAtRuntime('essential', unknown)).toBe(false);
  });
});

describe('scratchImageSize — 터미널 크기 → 스크래치 영역', () => {
  it('보통 크기 터미널에서는 비율대로 나온다', () => {
    expect(scratchImageSize(40, 120)).toEqual({ rows: 18, cols: 30 });
  });

  it('아주 좁은 터미널에서는 최솟값으로 잘린다', () => {
    expect(scratchImageSize(10, 40)).toEqual({ rows: 8, cols: 20 });
  });

  it('아주 넓은 터미널에서는 최댓값으로 잘린다', () => {
    expect(scratchImageSize(200, 400)).toEqual({ rows: 28, cols: 60 });
  });
});
