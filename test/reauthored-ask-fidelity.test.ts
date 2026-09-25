// ⭐ 72차: 「재저작이 «났다»」와 「재저작이 «옳았다»」는 다른 물음이다(JDG-T35 3단 ⑶).
//   #8230 은 재저작을 «일어나게» 했고 관측 레코드도 남겼는데, 자식 골의 ask 가
//   ***저작기 자신의 질문***으로 바뀌어 있었다(#8236 이 그것을 고쳤다).
//   이 시험은 그 ⑶ 을 «사람 눈»이 아니라 «값»으로 잡는 seam 을 문다.
import { describe, expect, test } from 'bun:test';
import { classifyReauthoredAsk, ORIGINAL_ASK_MARKER } from '../src/self-implement/goal-author.js';

function goalDocument(ask: string, newline = '\n'): string {
  return ['## PROBLEM', ORIGINAL_ASK_MARKER, '```', ask, '```', '', '- GoalId: 0123456789abcdef'].join(newline);
}

const humanAsk = 'Fix the seam that loses the human ask.';
const toolQuestion = 'Grounding did not find a code candidate matching a path named in the ask.';

describe('classifyReauthoredAsk', () => {
  test('preserved when the child carries the parent ask verbatim', () => {
    expect(classifyReauthoredAsk(goalDocument(humanAsk), goalDocument(humanAsk))).toBe('preserved');
  });

  // 📏 이것이 실제로 났던 결함이다 — 자식이 「도구의 질문」을 원래 ask 로 갖는다.
  test('replaced when the child ask became the tool question', () => {
    expect(classifyReauthoredAsk(goalDocument(humanAsk), goalDocument(toolQuestion))).toBe('replaced');
  });

  // ⛔ 「같지 않다」와 「못 쟀다」는 다른 값이다 — 못 읽으면 replaced 로 접지 않는다.
  test.each([
    ['parent has no marker', '## PROBLEM\nno marker here', goalDocument(humanAsk)],
    ['child has no marker', goalDocument(humanAsk), '## PROBLEM\nno marker here'],
    ['parent fence never closes', `## PROBLEM\n${ORIGINAL_ASK_MARKER}\n\`\`\`\n${humanAsk}`, goalDocument(humanAsk)],
  ])('unmeasurable when %s', (_caseName, parent, child) => {
    expect(classifyReauthoredAsk(parent, child)).toBe('unmeasurable');
  });

  test('reads CRLF documents and ignores surrounding blank lines', () => {
    expect(classifyReauthoredAsk(goalDocument(humanAsk, '\r\n'), goalDocument(`${humanAsk}\n`))).toBe('preserved');
  });

  // ⛔ 유사도가 아니라 동치다 — 한 낱말만 달라도 replaced 다(임계를 만들지 않는다).
  test('a single changed word is replaced, not preserved', () => {
    expect(classifyReauthoredAsk(goalDocument(humanAsk), goalDocument(humanAsk.replace('human', 'machine')))).toBe('replaced');
  });
});
