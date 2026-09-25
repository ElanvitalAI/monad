// FabricStageHeader 단계 표 배선 가드(F3 · 2026-07-09).
// 4 표면(intake·autopilot·tasks·scheduler)이 파이프라인 순서로·정확한 라우트로
// 연결됨을 잠근다. SIDEBAR_NAV_ITEMS 와 href 정합도 확인(사이드바 ↔ 단계 헤더 일치).

import { describe, it, expect } from 'bun:test';
import { FABRIC_STAGES } from './FabricStageHeader';
import { SIDEBAR_NAV_ITEMS } from './sidebar-nav-items';

describe('FABRIC_STAGES', () => {
  it('데이터 흐름 순서 = autopilot → tasks → scheduler (narrow-waist V3: intake 흡수)', () => {
    expect(FABRIC_STAGES.map((s) => s.key)).toEqual([
      'autopilot', 'tasks', 'scheduler',
    ]);
  });

  it('구 intake 단계는 제거됨(포착=골던지기·텔레그램으로 흡수)', () => {
    expect(FABRIC_STAGES.map((s) => s.href)).not.toContain('/intake');
  });

  it('각 단계 href 가 canonical 라우트', () => {
    const byKey = Object.fromEntries(FABRIC_STAGES.map((s) => [s.key, s.href]));
    expect(byKey.autopilot).toBe('/autopilot');
    expect(byKey.tasks).toBe('/tasks');
    expect(byKey.scheduler).toBe('/scheduler');
  });

  it('모든 단계 href 가 사이드바 nav 에도 존재(표면 정합)', () => {
    const navHrefs = new Set(SIDEBAR_NAV_ITEMS.map((i) => i.href));
    for (const s of FABRIC_STAGES) expect(navHrefs.has(s.href)).toBe(true);
  });

  it('label·sub·num 이 모두 채워짐', () => {
    for (const s of FABRIC_STAGES) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.sub.length).toBeGreaterThan(0);
      expect(s.num.length).toBeGreaterThan(0);
    }
  });
});
