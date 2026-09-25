import { describe, expect, it } from 'bun:test';
import { singleRunAsJobResult } from '../src/self-implement/self-implement-cli.js';

/** ⭐ 대표 지시(2026-09-08) — 「걸음」이 런 «밖»으로 나가 슈퍼바이저까지 닿는가.
 *
 *  🩸 그 전까지: `onNodeEntry` 는 «있었는데» 호출부가 ***0***(내부 기본 no-op) ⇒ 걸음이 런 안에서 끝났다.
 *    슈퍼바이저는 「시도의 요약 판정」(stage·stopReason·분류 …)만 보고 ***「어떻게 걸었나」를 못 봤다***.
 *  ⛔ 이것은 「관」이지 「제어」가 아니다 — 그 걸음으로 «무엇을 할지»는 별개 결정이다. */
const base = { runId: 'run-1', ok: true, stage: 'merged', node: 'merge', outcome: {} } as never;

describe('걸음이 슈퍼바이저까지 닿는다', () => {
  it('걸음이 있으면 «실린다»', () => {
    const job = singleRunAsJobResult('f', { ...(base as object), walk: [{ node: 'implement', round: 0 }] } as never);
    expect(job.walk).toEqual([{ node: 'implement', round: 0 }]);
  });

  it('⛔ 걸음이 «비었으면» 안 싣는다 — 「안 걸었다」와 「관측을 안 붙였다」를 같은 값으로 두지 않는다', () => {
    expect(singleRunAsJobResult('f', { ...(base as object), walk: [] } as never).walk).toBeUndefined();
    expect(singleRunAsJobResult('f', base).walk).toBeUndefined();
  });

  it('⛔ 반증 — 이 다리가 «항상 걸음»을 내지 않는다(안 주면 없다)', () => {
    const job = singleRunAsJobResult('f', base);
    expect('walk' in job).toBe(false);
  });
});
