import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { debug } from '../debug/log.js';
import { groundMissionInCodebase } from './mission-codebase-gate.js';

/**
 * grounding 집계기의 **관측 계약** — 개수만이 아니라 **어느 트리를 검색했나**를 남긴다.
 *
 * ⛔ 2026-07-28 실측이 만든 테스트다. 초판은 세 구멍이 있었다:
 *   ① 근거가 0 이면 **조기 반환하며 로그를 아예 안 남겼다** ⇒ 정작 알고 싶은 "왜 0 인가"가 조회에 없다.
 *   ② 예외를 **조용히 삼켰다** ⇒ 실패로 인한 0 과 진짜 부재가 같은 값이 된다.
 *   ③ 검색 대상 트리를 안 남겼다 ⇒ `code:0` 이 "관련 코드 없음"인지 "엉뚱한 트리"인지 못 가른다.
 *      호출자 cwd가 있으면 그 root를 기록해야 한다(FINDING 문서 참조)
 *
 * ⇒ "0건의 원인 넷"(진짜 부재 / 조인 불가 / 인스턴스 / 세대) 중 **조인 불가**를 이 로그가 가른다.
 */

const logged: { category: string; event: string; data: unknown }[] = [];

// ⚠️ 모듈 전체를 갈아끼우지 않는다 — `debug/log.js` 는 `redactSecrets` 등도 export 하고
//    다른 모듈이 그것을 import 하므로, mock.module 로 덮으면 **무관한 import 가 깨진다**(실측).
//    ⇒ 인스턴스의 `log` 메서드만 가로채고 끝나면 되돌린다.
type LogFn = typeof debug.log;
let original: LogFn;
beforeAll(() => {
  original = debug.log.bind(debug) as LogFn;
  (debug as { log: LogFn }).log = ((category: string, event: string, data?: unknown) => {
    logged.push({ category, event, data });
  }) as LogFn;
});
afterAll(() => { (debug as { log: LogFn }).log = original; });

/** 모든 코퍼스를 비게 만드는 deps — 순수 주입이라 네트워크·LLM·git 을 안 탄다. */
const emptyDeps = {
  searchTerms: async () => ['qxjvplmno'],
  skillIndex: () => [],
  pickSkills: async () => [],
  recallMemory: async () => [],
  recallSelf: async () => [],
  refDigest: () => '',
  persistent: false,
} as const;

function grounding() {
  return logged.filter((l) => l.category === 'mission.grounding' && l.event === 'corpus');
}

describe('grounding 집계기의 관측 계약', () => {
  it('⭐ 근거가 0건이어도 로그를 남긴다 — cwd 와 사유를 함께', async () => {
    logged.length = 0;
    const r = await groundMissionInCodebase('존재하지 않는 주제 zzz-no-such-term', emptyDeps as never);
    expect(r.grounded).toBe(false);

    const rows = grounding();
    // ⛔ 초판은 여기서 0 이었다 — 조기 반환이 로그보다 앞섰다.
    expect({ '0건_로그_남김': rows.length > 0 }).toEqual({ '0건_로그_남김': true });

    const d = rows.at(-1)!.data as Record<string, unknown>;
    expect({ grounded: d.grounded, reason: d.reason }).toEqual({ grounded: false, reason: 'no-corpus' });
    // ⭐ 검색 트리가 실제 경로여야 한다 — 이것이 "조인 불가"를 가르는 필드다.
    expect({ cwd_실제경로: typeof d.cwd === 'string' && (d.cwd as string).startsWith('/'), cwdSource: d.cwdSource })
      .toEqual({ cwd_실제경로: true, cwdSource: 'process' });
  });

  it('호출자 cwd가 process cwd와 달라도 corpus 로그가 그 root를 식별한다', async () => {
    logged.length = 0;
    const cwd = '/tmp/caller-selected-grounding-root';
    await groundMissionInCodebase('no corpus', { ...emptyDeps, cwd } as never);
    expect(grounding().at(-1)!.data).toMatchObject({ cwd, cwdSource: 'caller' });
  });

  it('⭐ 예외로 죽어도 조용하지 않다 — reason:error 로 남는다', async () => {
    logged.length = 0;
    const r = await groundMissionInCodebase('x', {
      ...emptyDeps,
      searchTerms: async () => { throw new Error('boom-from-test'); },
    } as never);
    // fail-soft 계약은 유지된다(분해를 막지 않는다).
    expect(r.grounded).toBe(false);

    const rows = grounding();
    expect({ 예외_로그_남김: rows.length > 0 }).toEqual({ 예외_로그_남김: true });
    const d = rows.at(-1)!.data as Record<string, unknown>;
    expect({ reason: d.reason, 원문포함: String(d.error).includes('boom-from-test') })
      .toEqual({ reason: 'error', 원문포함: true });
  });

  it('⛔ 셋(성공·0건·예외)이 서로 구별된다 — 같은 값이면 조회가 거짓을 생산한다', async () => {
    logged.length = 0;
    await groundMissionInCodebase('a', emptyDeps as never);
    await groundMissionInCodebase('b', { ...emptyDeps, searchTerms: async () => { throw new Error('e'); } } as never);
    const reasons = grounding().map((l) => (l.data as Record<string, unknown>).reason);
    expect(reasons).toEqual(['no-corpus', 'error']);
  });
});
