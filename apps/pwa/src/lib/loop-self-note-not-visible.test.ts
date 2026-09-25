// ── 루프가 «자기에게» 하는 말은 사람 말풍선이 되면 안 된다 ──
//
// ⛔⭐ **이 시험이 있는 이유**(2026-08-21): 데몬 루프가 빈-턴 교정문과 doom-loop 개입문을
//   `role:'user'` 로 대화 히스토리에 밀어 넣었다. 그것이 세션 스토어에 «그대로 저장»되고
//   PWA 가 거기서 수화하므로, 사람에게 ***파란 말풍선 = 오류처럼*** 보였다.
//   대표: *"사용자에게 오류로 보이고 UX 경험을 해친다 — 최소 노출이 안 되게"*
//
// ⚠️ 이 계약은 «두 층에 걸쳐» 있다 — 데몬이 고르는 role ⊕ PWA 가 거르는 role.
//   한쪽만 보는 시험은 원리상 이 결함을 못 잡는다. 그래서 여기서 «양쪽»을 잇는다.

import { describe, expect, test } from 'bun:test';
import { mapServerHistoryToChat, mapServerMessageToChat } from './dock-history-hydrate';
// ⭐ 데몬이 «실제로 쓰는» 상수를 그대로 가져온다 — 여기 문자열을 베껴 두면
//   데몬이 바꿔도 이 시험은 «계속 통과»한다(2026-08-21 에 실제로 그랬다).
import { LOOP_SELF_NOTE_ROLE } from '../../../../src/llm';

const EMPTY_TURN_NUDGE =
  'Your previous turn produced no text and no tool calls. '
  + 'If the task is complete, emit your FINAL ANSWER as plain text now.';

describe('내부 자기-노트는 화면에 «안» 뜬다', () => {
  test('⭐ 데몬이 고른 역할이 «PWA 가 거르는» 역할과 같다 (두 층을 잇는 단언)', () => {
    // ⛔ 이 한 줄이 이 시험의 «본체»다. 데몬이 role 을 user 로 되돌리면 여기서 깨진다.
    expect(mapServerMessageToChat(
      { role: LOOP_SELF_NOTE_ROLE, content: EMPTY_TURN_NUDGE } as never, 0,
    )).toBeNull();
  });

  test('빈-턴 교정문이 system 이면 말풍선이 «생기지 않는다»', () => {
    const mapped = mapServerMessageToChat(
      { role: LOOP_SELF_NOTE_ROLE, content: EMPTY_TURN_NUDGE } as never, 0,
    );
    expect(mapped).toBeNull();
  });

  test('🚨 회귀 — 같은 문장이 user 로 오면 «말풍선이 된다»(옛 결함의 모양)', () => {
    const mapped = mapServerMessageToChat(
      { role: 'user', content: EMPTY_TURN_NUDGE } as never, 0,
    );
    // ⛔ 이 단언은 「user 면 뜬다」를 «못 박는» 것이다 — 그래서 데몬이 user 를 쓰면 안 된다.
    expect(mapped).not.toBeNull();
  });

  test('사람이 «실제로 친» 말은 그대로 뜬다 — 전부 숨기면 안 된다', () => {
    const mapped = mapServerMessageToChat({ role: 'user', content: '은행잎 그려줘' } as never, 0);
    expect(mapped).not.toBeNull();
    expect(JSON.stringify(mapped)).toContain('은행잎');
  });

  test('한 대화에서 자기-노트만 빠지고 나머지는 순서대로 남는다', () => {
    const out = mapServerHistoryToChat([
      { role: 'user', content: '그려줘' },
      { role: LOOP_SELF_NOTE_ROLE, content: EMPTY_TURN_NUDGE },
      { role: 'assistant', content: '그렸습니다' },
    ] as never);
    expect(out).toHaveLength(2);
    expect(JSON.stringify(out[0])).toContain('그려줘');
    expect(JSON.stringify(out[1])).toContain('그렸습니다');
  });
});
