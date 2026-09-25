import { describe, expect, test } from 'bun:test';

import { textInput } from '../src/chat/index.js';
import { debug } from '../src/debug/log.js';
import type { Key } from '../src/tui.js';

function escapeKey(): Key {
  return { name: 'escape', ctrl: false, shift: false };
}

describe('textInput Escape observation', () => {
  test('records chat-input consumption for host-owned rewind before default cancellation', async () => {
    const keys = [escapeKey(), escapeKey()];
    let onEscapeCalls = 0;

    const result = await textInput({
      row: 1,
      col: 1,
      width: 80,
      readKey: async () => keys.shift()!,
      onEscape: () => ++onEscapeCalls === 1,
    });

    expect(result).toEqual({ text: '', submitted: false, cancelledBy: 'escape' });
    expect(onEscapeCalls).toBe(2);
    // ⛔ 전역 버퍼를 **개수로 자르면** 링 버퍼 축출·병렬 기록에 흔들린다(무인 리뷰 should-fix).
    //    ⇒ **꼬리를 맞춘다** — 이 테스트가 방금 낸 것이 마지막에 있다는 것만 본다.
    const events = debug.events(10_000)
      .filter((event) => event.category === 'esc.abort')
      .slice(-2);
    expect(events.map((event) => [event.event, event.data])).toEqual([
      ['chat-input-consumed', { decision: 'on-escape' }],
      ['chat-input-consumed', { decision: 'cancel-input' }],
    ]);
  });
});
