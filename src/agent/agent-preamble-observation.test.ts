import { describe, expect, it, spyOn } from 'bun:test';
import { debug } from '../debug/log.js';
import { buildAgentMessages } from './runner.js';
import type { AgentDefinition } from './types.js';

/**
 * ⛔⭐⭐⭐ 상설 PLAN §6 ② 의 «읽는 자».
 *
 * 물음: *「omitInheritedContext 자식은 프로젝트 앵커(=디자인)를 못 본다 — 결손인가 의도인가」*
 * 📏 코드는 «의도»라고 «말한다»(runner.ts 의 "that flag's whole purpose is to deliver a SLIM context").
 *    ⛔ 그런데 ***누가 얼마나 그러는지***는 못 셌다 — 관측이 `if (debug.enabled)` 뒤에 있었기 때문이다.
 *
 * 🚨 2026-08-26 실측:
 *    ⓐ 등록된 로그 스토어 ***109개 전수***에서 `chat.agent-preamble` ***0행***
 *    ⓑ 직접 태워 보니 `debug.enabled=false` 에서 경로는 «돌았는데» 이벤트가 ***0개***
 *    ⇒ 「사건이 없다」가 아니라 ***「게이트가 막았다」***(CLAUDE.md 「0건」 축 ⑪).
 *
 * 🪞 `#12766` 이 «바로 옆»(앵커 절단 관측)에서 이미 닫은 결함의 «쌍둥이»다.
 *    ⇒ 이 파일은 그 회귀를 코드로 잠근다. ⛔ 수를 여기 박지 않는다.
 */
function def(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return { name: 'probe', systemPrompt: 'system', ...overrides } as AgentDefinition;
}

function observedEvents(run: () => void): Array<{ event: string; data: Record<string, unknown> }> {
  const seen: Array<{ event: string; data: Record<string, unknown> }> = [];
  const spy = spyOn(debug, 'log').mockImplementation((category, event, data) => {
    if (category === 'chat.agent-preamble') seen.push({ event, data: (data ?? {}) as Record<string, unknown> });
  });
  try { run(); } finally { spy.mockRestore(); }
  return seen;
}

describe('sub-agent 프리앰블 관측 — 「누가 프로젝트 앵커를 못 봤나」', () => {
  // ⛔⭐ 이 시험의 핵심은 «내용»이 아니라 ***debug 게이트 «밖»에서 나는가***다.
  //   그래서 debug.enabled 를 «켜지 않고» 문다. 켜면 옛 결함도 통과한다.
  it('debug 게이트가 꺼져 있어도 관측이 «난다» (omit 자식)', () => {
    expect(debug.enabled).toBe(false);
    const seen = observedEvents(() => {
      buildAgentMessages(def({ omitInheritedContext: true }), 'p', 'PARENT', { cwd: process.cwd() });
    });
    const resolved = seen.filter((e) => e.event === 'resolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.data).toMatchObject({
      agent: 'probe',
      projectAnchorIncluded: false,
      reason: 'omit-inherited-context',
    });
  });

  it('앵커를 «받은» 자식도 같은 관문으로 관측된다 — 「0건」이 두 뜻을 갖지 않게', () => {
    expect(debug.enabled).toBe(false);
    const seen = observedEvents(() => {
      buildAgentMessages(def(), 'p', 'PARENT', { cwd: process.cwd() });
    });
    const resolved = seen.filter((e) => e.event === 'resolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.data).toMatchObject({ agent: 'probe', projectAnchorIncluded: true, reason: 'included' });
  });

  // ⛔ cwd 가 없어 앵커가 «안 붙는» 경로도 같은 이름으로 잡힌다 —
  //   그러지 않으면 「omit 이라서」와 「cwd 가 없어서」가 조회에서 같은 모양이 된다.
  it('cwd 가 없어 못 붙인 경우와 omit 을 «다른 값»으로 낸다', () => {
    const seen = observedEvents(() => { buildAgentMessages(def(), 'p', 'PARENT', {}); });
    const resolved = seen.filter((e) => e.event === 'resolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.data).toMatchObject({ projectAnchorIncluded: false, reason: 'no-cwd' });
  });
});
