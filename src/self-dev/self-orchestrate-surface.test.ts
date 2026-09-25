import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isSelfOrchestrateModelSurfaceEnabled } from './self-orchestrate-runtime.js';
import { registerAllDefaultToolRuntimes } from '../tool-runtime/index.js';
import { listToolRuntimes, _resetToolRuntimeRegistryForTest } from '../tool-runtime/registry.js';
import { setUserConfigOverlay } from '../user-config.js';

/** ⛔ 전역 상태 둘을 «매번» 초기화한다 — 안 하면 개발자의 실제 config 나 앞 시험의 등록이
 *  이 시험의 답을 바꾼다(리뷰 #10602: 순서·환경 의존). */
const withTools = (selfOrchestrate: { modelSurface?: boolean }): void => {
  setUserConfigOverlay((cfg) => ({ ...cfg, tools: { ...cfg.tools, selfOrchestrate } }));
};

beforeEach(() => { _resetToolRuntimeRegistryForTest(); });
afterEach(() => { _resetToolRuntimeRegistryForTest(); setUserConfigOverlay(null); });

describe('SelfOrchestrate 모델 표면 — 흡수 뒤 «옛 문»을 닫는다', () => {
  test('⛔ 기본이 off 다 — 명시로 켜야 열린다', () => {
    // 🔑 흡수가 끝났으므로(SelfImplement 가 goals[] 를 받고 «같은 함수»로 간다)
    //   둘째 문은 능력이 아니라 파편화다. 대표 결정 2026-08-20.
    withTools({});
    expect(isSelfOrchestrateModelSurfaceEnabled()).toBe(false);
  });

  test('⭐⭐ 등록 «후»에도 모델 표면에 «없다» — 선언이 아니라 실물로 문다', () => {
    withTools({});
    registerAllDefaultToolRuntimes();
    const ids = listToolRuntimes().map((rt) => rt.id);
    // ⛔ 「등록 코드가 조건문 안에 있다」가 아니라 ***「실제로 목록에 없다」***를 문다.
    expect(ids.filter((id) => /orchestrate/i.test(id))).toEqual([]);
  });

  test('⭐⭐ 되돌리기가 «실물로» 된다 — config 한 줄이면 목록에 «다시» 나타난다', () => {
    // ⛔ 「되돌릴 수 있다」를 문서로만 주장하지 않는다(리뷰 #10602 must-fix).
    withTools({ modelSurface: true });
    expect(isSelfOrchestrateModelSurfaceEnabled()).toBe(true);
    registerAllDefaultToolRuntimes();
    const ids = listToolRuntimes().map((rt) => rt.id);
    expect(ids.filter((id) => /orchestrate/i.test(id))).not.toEqual([]);
  });

  test('⭐ 그런데 «능력»은 어느 쪽이든 남아 있다 — self_implement 가 그 자리를 갖는다', () => {
    withTools({});
    registerAllDefaultToolRuntimes();
    const ids = listToolRuntimes().map((rt) => rt.id);
    // 🔑 이것이 「내렸다」와 「없앴다」를 가른다. 문만 닫고 능력은 그대로다.
    expect(ids.filter((id) => /implement/i.test(id))).toContain('self_implement');
  });
});
