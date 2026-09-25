import { describe, expect, it } from 'bun:test';
import { buildUniversalPreamble, resetUniversalPreambleCache } from './universal-preamble.js';

/**
 * ⛔⭐⭐⭐ 상설 PLAN §6 ③ 의 «읽는 자» — *「매 자식에게 26KB 가 간다 — 이 계획이 경고한 비용을
 * ***끝내 안 쟀다***」*.
 *
 * 📏 2026-08-26 실측 (⛔ 수를 여기 박지 않는다 — 아래는 «왜 이 시험이 있나»의 근거다):
 *    ⓐ 계획이 적은 「26KB」는 ***앵커만***이었다. 자식이 실제로 받는 프리앰블은 그보다 «더 크다».
 *    ⓑ 그런데 ***그 큰 덩어리 전체가 «안정 접두»***였다 — 자식마다 달라지는 것
 *       (modelFamily 애드덤 · enabledTools 목록)이 ***전부 «뒤»에 붙는다***.
 *    ⇒ 🔑 그래서 비용은 「N × 전체」가 아니다. ***프롬프트 캐시가 그 접두를 먹는다.***
 *
 * 🚨 그리고 그 성질은 ***순서에만 기대어 서 있다.*** 누군가 모델 애드덤을 앵커 «앞»으로 옮기면
 *    모든 모델 패밀리가 서로의 캐시를 깨고, ***아무 시험도 빨개지지 않는다*** — 산출은 여전히 옳으니까.
 *    ⛔ 그게 이 파일이 있는 이유다. 이 시험은 «내용»이 아니라 ***「접두가 공유되나」***를 문다.
 *
 * ⚠️ 이 시험이 «못» 답하는 것: 프로바이더가 실제로 캐시를 먹였는지. 그건 청구서·응답 메타의 몫이고
 *    여기서는 ***「캐시가 먹을 수 있는 «모양»인가」***까지다.
 */
const CWD = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

function preambleText(opts: Record<string, unknown> = {}): string {
  resetUniversalPreambleCache();
  return buildUniversalPreamble({ cwd: CWD, ...opts } as never)
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');
}

const VARIANTS: Array<[string, Record<string, unknown>]> = [
  ['modelFamily=claude', { modelFamily: 'claude' }],
  ['modelFamily=codex', { modelFamily: 'codex' }],
  ['enabledTools 하나', { enabledTools: ['Read'] }],
  ['enabledTools 둘', { enabledTools: ['Read', 'Bash'] }],
  ['둘 다', { modelFamily: 'claude', enabledTools: ['Read', 'Bash'] }],
];

describe('sub-agent 프리앰블 — 자식마다 달라지는 것은 «뒤»에 붙는다(캐시 접두 보존)', () => {
  it.each(VARIANTS)('%s 를 줘도 공통 부분이 «접두»로 남는다', (_label, opts) => {
    const base = preambleText();
    const variant = preambleText(opts);
    // ⛔ 「같은 문자열이 들어 있다」로는 부족하다 — ***앞에서부터*** 같아야 캐시가 먹는다.
    expect(variant.startsWith(base)).toBe(true);
  });

  // ⛔⭐ 위 시험이 «공짜로» 통과하는 길을 막는다 — base 가 비어 있으면 startsWith 는 항상 참이다.
  //   그건 「접두가 보존된다」가 아니라 ***「잴 것이 없다」***다.
  it('기준 프리앰블이 실제로 «있다» — 위 시험이 공짜로 통과하는 것을 막는다', () => {
    const base = preambleText();
    expect(base.length).toBeGreaterThan(0);
    // 앵커가 실제로 실렸는지까지 문다 — cwd 해석이 깨지면 base 가 «작지만 비지는 않게» 남는다.
    expect(base).toContain('AGENTS.md');
  });

  // ⛔⭐ 그리고 변형이 실제로 «뭔가를 더했는지»도 문다. 아무것도 안 붙으면 위 시험은
  //   「접두가 보존된다」가 아니라 ***「옵션이 무시된다」***를 통과시킨다(그건 다른 결함이다).
  it('변형은 «뒤에» 실제로 무언가를 더한다 — 옵션이 조용히 무시되는 것을 막는다', () => {
    const base = preambleText();
    for (const [, opts] of VARIANTS) {
      expect(preambleText(opts).length).toBeGreaterThan(base.length);
    }
  });
});
