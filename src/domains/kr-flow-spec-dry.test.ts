// turn 조립기 통일 C-① — finance_kr_flow ↔ KrFlowSnapshot spec DRY 가드.
//
// finance_kr_flow(finance 팩)와 KrFlowSnapshot(skill runner)은 이미 같은 dispatchKrFlow 로 라우팅되나
// spec 이 2벌이라 command 목록이 드리프트했다(finance 는 하드코딩·skill 은 상수 자동파생). C-① 는
// finance_kr_flow 의 파라미터를 canonical buildKrFlowTool() 에서 상속하게 해 command enum 을 단일
// 출처(VALID_COMMANDS)로 못박는다. 이 테스트는 그 상속 + 서피스 계약(이름·rich 한글 description) 보존을 가드.

import { describe, test, expect } from 'bun:test';
import { buildFinanceTools } from './finance-tools.js';
import { buildKrFlowTool } from '../skills/tools/kr-flow.js';

describe('C-① finance_kr_flow spec DRY', () => {
  const specs = buildFinanceTools().specs;
  const krFlow = specs.find((s) => s.name === 'finance_kr_flow');

  test('finance_kr_flow 존재 + 이름 계약 유지', () => {
    expect(krFlow).toBeTruthy();
    expect(krFlow!.name).toBe('finance_kr_flow');
  });

  test('rich 한글 description 은 서피스 계약이라 유지(canonical 영문과 다름)', () => {
    expect(krFlow!.description).toContain('한국투자증권');
    expect(krFlow!.description).toContain('반드시 이 도구');
    // canonical(KrFlowSnapshot) 영문 description 과는 별개 — 각 서피스 계약.
    expect(krFlow!.description).not.toBe(buildKrFlowTool().description);
  });

  test('parameters 는 canonical buildKrFlowTool 에서 상속(command enum 단일 출처)', () => {
    const canon = buildKrFlowTool();
    const p = krFlow!.parameters as { properties: Record<string, { enum?: string[] }> };
    const cp = canon.parameters as { properties: Record<string, { enum?: string[] }> };
    // command enum 이 상수에서 자동 파생 = canonical 과 동일 목록(드리프트 불가).
    expect(p.properties.command.enum).toEqual(cp.properties.command.enum);
    expect((p.properties.command.enum ?? []).length).toBeGreaterThanOrEqual(17);
    // 파생상품/시장 명령이 enum 에 포함(종전 하드코딩이 놓칠 수 있던 것).
    expect(p.properties.command.enum).toContain('krx-futures');
    expect(p.properties.command.enum).toContain('estimate');
    // timeout_ms 도 canonical 에서 상속.
    expect(p.properties.timeout_ms).toBeTruthy();
  });
});
