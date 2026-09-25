// ── mission-ux-live 동적 액션 라우터 회귀 테스트 (2026-07-21) ──────────────────
// handleUxDynamicAction 이 관측-only 액션(arc-surgery·dep-mission·미지원)을 spawn 없이 안전 라우팅하는지
// (throw 없이 종료) 검증. spawn 경로(redecompose 등)는 실 프로세스 스폰이라 여기서 태우지 않고
// 재사용 함수(spawnMissionPrepare·rebuildCritiquedPhases)의 각 테스트 + tsc-gate 로 커버.

import { test, expect } from 'bun:test';
import { handleUxDynamicAction, defaultUxConsumerDeps } from './mission-ux-live.js';

test('handleUxDynamicAction — 관측-only 액션은 spawn 없이 안전 종료', () => {
  // arc-surgery / dep-mission / 미지원 = debug.log 관측만(실처리 부재). throw 금지.
  expect(() => handleUxDynamicAction('m-test', 'arc-surgery')).not.toThrow();
  expect(() => handleUxDynamicAction('m-test', 'dep-mission')).not.toThrow();
  expect(() => handleUxDynamicAction('m-test', 'no-such-action')).not.toThrow();
});

test('defaultUxConsumerDeps — action 이 handleUxDynamicAction 로 라우팅(관측-only 액션 안전)', () => {
  const deps = defaultUxConsumerDeps();
  // action(missionId, optionId) → handleUxDynamicAction. 관측-only 액션은 부작용 없이 종료.
  expect(() => deps.action('m-test', 'dep-mission')).not.toThrow();
});
