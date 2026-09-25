// ⛔⭐ 세션 관측 관문이 **어느 PTY 에서 났는지**를 한 번에 얹는지 고정한다.
//   ⚠️ 이것은 pty↔session **결속의 증명이 아니다** — 세션은 nexus 데몬이 소유하고
//      TUI 는 ACP 로 말한다(매뉴얼 §0a ⑶b). 여기서 잡히는 것은 **PTY 안에서 난 세션 이벤트**뿐이다.

import { afterEach, describe, expect, test } from 'bun:test';
import { recordSessionObservation } from './session-observation.js';

const prior = process.env.MONAD_PTY_ID;
afterEach(() => {
  if (prior === undefined) delete process.env.MONAD_PTY_ID;
  else process.env.MONAD_PTY_ID = prior;
});

describe('recordSessionObservation — refs.ptyId', () => {
  test('PTY 안에서 나면 refs 에 ptyId 가 실린다', () => {
    process.env.MONAD_PTY_ID = 'pty_abcdef01';
    const rows: Array<{ data: unknown }> = [];
    recordSessionObservation(
      { sessionId: 's1', subsystem: 'handoff', event: 'attached' },
      { logSink: (_c, _e, data) => rows.push({ data }) },
    );
    expect((rows[0]!.data as { refs?: { ptyId?: string } }).refs?.ptyId).toBe('pty_abcdef01');
  });

  test('무관한 refs 는 보존한다 (⚠️ ptyId 키 자체는 관문이 이긴다 — 아래 테스트가 그 정책을 고정한다)', () => {
    process.env.MONAD_PTY_ID = 'pty_abcdef01';
    const rows: Array<{ data: unknown }> = [];
    recordSessionObservation(
      { sessionId: 's1', subsystem: 'fanout', event: 'delivered', refs: { streamId: 'x' } },
      { logSink: (_c, _e, data) => rows.push({ data }) },
    );
    const refs = (rows[0]!.data as { refs?: Record<string, unknown> }).refs!;
    expect(refs.streamId).toBe('x');
    expect(refs.ptyId).toBe('pty_abcdef01');
  });

  test('refs.ptyId 가 이미 있어도 관문 값이 이긴다 (충돌 정책)', () => {
    // ⛔ 호출부가 손으로 넣은 값보다 **환경이 말하는 실제 PTY** 를 믿는다 —
    //    관측 태그가 호출부의 오기로 거짓이 되면 안 된다.
    process.env.MONAD_PTY_ID = 'pty_abcdef01';
    const rows: Array<{ data: unknown }> = [];
    recordSessionObservation(
      { sessionId: 's1', subsystem: 'handoff', event: 'attached', refs: { ptyId: 'pty_00000000' } },
      { logSink: (_c, _e, data) => rows.push({ data }) },
    );
    expect((rows[0]!.data as { refs?: { ptyId?: string } }).refs?.ptyId).toBe('pty_abcdef01');
  });

  test('PTY 밖이면 ptyId 를 만들지 않는다 (빈 경로)', () => {
    delete process.env.MONAD_PTY_ID;
    const rows: Array<{ data: unknown }> = [];
    recordSessionObservation(
      { sessionId: 's1', subsystem: 'handoff', event: 'attached' },
      { logSink: (_c, _e, data) => rows.push({ data }) },
    );
    expect((rows[0]!.data as { refs?: { ptyId?: string } }).refs?.ptyId).toBeUndefined();
  });
});
