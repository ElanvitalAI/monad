// self-ops family — TUI 채팅 3박자의 '툴' 축 계약 (P3 · 2026-07-13).
// L2 코어 도구(ops_status·autopilot_missions·…)가 host tool 로 주어지면 어떤 surface 든
// 기본 노출(default family)되는지 + 무관 host tool 은 여전히 family 게이트로 걸러지는지.
import { test, expect, describe } from 'bun:test';
import { buildSessionRuntimeToolSpecs } from './index.js';

const def = (name: string) => ({
  name, description: `${name} tool`,
  parameters: { type: 'object', properties: {}, required: [] as string[] },
  handler: async () => ({}),
});

const CORE = ['ops_status', 'autopilot_missions', 'self_recall', 'memory_recall', 'session_manage', 'schedule_manage', 'fact_check', 'se_build'];

describe('self-ops family — 코어 도구 기본 노출', () => {
  test('키워드 없는 평문에서도 코어 7종 전부 노출(기본 family)', () => {
    const specs = buildSessionRuntimeToolSpecs({
      userText: '안녕, 오늘 날씨 어때',
      hostTools: [...CORE.map(def), def('view_setActive')],
    });
    const names = new Set(specs.map((s) => s.name));
    for (const n of CORE) expect(names.has(n)).toBe(true);
    // 무관 host tool(ui-mutate 계열)은 intent 없으면 여전히 미노출 — family 게이트 보존.
    expect(names.has('view_setActive')).toBe(false);
  });

  test('미션 질문("P2 왜 실패했어?")에서도 ops_status 노출(match 규칙 겸용)', () => {
    const specs = buildSessionRuntimeToolSpecs({
      userText: 'P2 페이즈 왜 실패했어?',
      hostTools: [def('ops_status'), def('autopilot_missions')],
    });
    const names = new Set(specs.map((s) => s.name));
    expect(names.has('ops_status')).toBe(true);
    expect(names.has('autopilot_missions')).toBe(true);
  });
});
