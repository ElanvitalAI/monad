import { describe, expect, test } from 'bun:test';
import { measureReviewFindingRecurrence, symbolBaseName } from './review-finding-recurrence.js';

const f = (id: string, item: string) => ({ id, item });

describe('symbolBaseName — 한정을 벗긴다', () => {
  test('마지막 «.» 뒤 ⊕ «()» 제거', () => {
    expect(symbolBaseName('McpToolAuthorizer.revoke()')).toBe('revoke');
    expect(symbolBaseName('revoke()')).toBe('revoke');
    expect(symbolBaseName('McpClientsHandle.authorizer')).toBe('authorizer');
    expect(symbolBaseName('plain')).toBe('plain');
  });
});

describe('measureReviewFindingRecurrence — 축 «셋»이 각자 다른 것을 잡는다', () => {
  test('⭐⭐ 🅕 실물 — 한정이 라운드마다 달라도 «기본 이름»이 잡는다', () => {
    // 📏 실물(goalId 049db6c92879988f · 🅣 가 생 키로 갈라 확인):
    //   round 1  McpClientsHandle.authorizer · revoke()
    //   round 2  McpToolAuthorizer.revoke()
    //   ⇒ 판사 산문은 「반복」이라 했고 사람이 확인했는데 계측은 0 이었다.
    const previous = [f('a', '`McpClientsHandle.authorizer` · `revoke()` 가 DEAD')];
    const current = [f('b', '`McpToolAuthorizer.revoke()` 가 DEAD')];
    expect(measureReviewFindingRecurrence(current, previous)).toEqual({
      normalizedRepeatedReviewFindingCount: 0,   // 문면이 다르다
      ordinaryRepeatedReviewFindingCount: 0,
      previouslyDismissedRepeatedReviewFindingCount: 0,
      citedReviewSymbolRepeatCount: 0,           // 한정이 다르다
      citedReviewSymbolBaseNameRepeatCount: 1,   // ✅ 잡았다
      comparableFindings: 1,
      reviewFindingKeyRepeatCount: 0,            // 심볼 집합이 다르다
    });
  });

  test('⛔ 「비교할 게 없다」를 「반복 0」과 «가른다»', () => {
    // 첫 라운드(이전 없음)는 「반복 없음」이 «아니다».
    expect(measureReviewFindingRecurrence([f('a', '`x` 가 문제')], undefined)).toBeNull();
    expect(measureReviewFindingRecurrence([f('a', '`x` 가 문제')], [])).toBeNull();
  });

  test('⛔⭐ 비교 «상대»가 없어도 «분모에서» 뺀다 — 한쪽만 보고 「반복 0」이라 말하지 않는다', () => {
    // 📏 리뷰 #10615 must-fix: 첫 판은 «이전»에 심볼이 하나도 없어도
    //   현재 쪽이 인용하면 comparableFindings=1 · 반복 0 을 냈다.
    //   ⇒ 읽는 쪽은 그것을 「봤는데 반복 없음」으로 읽는다. ***내가 세운 분모 규칙을 «내가» 깼다.***
    const r = measureReviewFindingRecurrence(
      [f('a', '`revoke()` 가 DEAD')],          // 현재: 심볼 «있다»
      [f('b', '백틱 없는 산문 지적입니다')],      // 이전: 심볼 «없다»
    );
    expect(r).toEqual({
      normalizedRepeatedReviewFindingCount: 0,
      ordinaryRepeatedReviewFindingCount: 0,
      previouslyDismissedRepeatedReviewFindingCount: 0,
      citedReviewSymbolRepeatCount: 0,
      citedReviewSymbolBaseNameRepeatCount: 0,
      comparableFindings: 0,   // ⭐ 「반복 0」이 아니라 «못 쟀다»
      reviewFindingKeyRepeatCount: 0,            // 심볼 키 vs 산문 키
    });
  });

  test('⛔ 심볼 인용이 «없는» 지적은 «분모에서» 뺀다 — 0 으로 세지 않는다', () => {
    const r = measureReviewFindingRecurrence(
      [f('a', '백틱 없는 산문 지적입니다')],
      [f('b', '`revoke()` 가 DEAD')],
    );
    expect(r).toEqual({
      normalizedRepeatedReviewFindingCount: 0,
      ordinaryRepeatedReviewFindingCount: 0,
      previouslyDismissedRepeatedReviewFindingCount: 0,
      citedReviewSymbolRepeatCount: 0,
      citedReviewSymbolBaseNameRepeatCount: 0,
      comparableFindings: 0,   // ⭐ 「0건 반복」이 아니라 「0건을 «잴 수 있었다»」
      reviewFindingKeyRepeatCount: 0,            // 산문 키 vs 심볼 키
    });
  });

  test('id 가 «그대로» 같으면 id 축이 잡는다 — 가장 정확한 축', () => {
    const same = f('MF-1', '`revoke()` 가 DEAD');
    const r = measureReviewFindingRecurrence([same], [same]);
    expect(r?.normalizedRepeatedReviewFindingCount).toBe(1);
    expect(r?.citedReviewSymbolRepeatCount).toBe(1);
  });

  test('수용된 반박으로 기각된 재발은 일반 반복과 별도 값으로 센다', () => {
    const dismissed = f('MF-dismissed', '`dismissed()` 가 문제');
    const ordinary = f('MF-ordinary', '`ordinary()` 가 문제');
    const recurrence = measureReviewFindingRecurrence(
      [dismissed, ordinary],
      [dismissed, ordinary],
      { acceptedRefutationFindingIds: ['MF-dismissed'] },
    );
    expect(recurrence).toMatchObject({
      normalizedRepeatedReviewFindingCount: 2,
      ordinaryRepeatedReviewFindingCount: 1,
      previouslyDismissedRepeatedReviewFindingCount: 1,
    });
    expect(recurrence).not.toBeNull();
    expect(recurrence!.ordinaryRepeatedReviewFindingCount + recurrence!.previouslyDismissedRepeatedReviewFindingCount).toBe(
      recurrence!.normalizedRepeatedReviewFindingCount,
    );
  });

  test('반박 이력이 없거나 읽을 수 없으면 기존처럼 일반 반복으로 센다', () => {
    const finding = f('MF-1', '`revoke()` 가 문제');
    const unreadableHistory = { acceptedRefutationFindingIds: 'MF-1' } as unknown as Parameters<typeof measureReviewFindingRecurrence>[2];
    for (const history of [undefined, { acceptedRefutationFindingIds: [''] }, unreadableHistory]) {
      expect(measureReviewFindingRecurrence([finding], [finding], history)).toMatchObject({
        normalizedRepeatedReviewFindingCount: 1,
        ordinaryRepeatedReviewFindingCount: 1,
        previouslyDismissedRepeatedReviewFindingCount: 0,
      });
    }
  });

  test('⛔ 기본 이름 축이 «전체 이름 축을 대체하지 않는다» — 둘이 다른 값을 낼 수 있다', () => {
    // 서로 «다른 타입»의 같은 멤버명 — 기본 이름은 겹치지만 전체 이름은 안 겹친다.
    const r = measureReviewFindingRecurrence(
      [f('a', '`Foo.close()` 가 문제')],
      [f('b', '`Bar.close()` 가 문제')],
    );
    expect(r?.citedReviewSymbolRepeatCount).toBe(0);          // 전체 이름: 안 겹침
    expect(r?.citedReviewSymbolBaseNameRepeatCount).toBe(1);  // 기본 이름: 겹침(과검출 가능)
    expect(r?.reviewFindingKeyRepeatCount).toBe(0);           // 키는 전체 심볼 집합
    // 🔑 그래서 «합치지 않는다» — 읽는 쪽이 두 수를 보고 판단한다.
  });

  test('같은 심볼·다른 문장·다른 id 면 키 축은 1, id 축은 0', () => {
    const previous = [f('id-prev', '`Foo.bar()` 가 쓰이지 않는다')];
    const current = [f('id-curr', '문장이 바뀌어도 `Foo.bar()` 는 여전히 DEAD')];
    const r = measureReviewFindingRecurrence(current, previous);
    expect(r?.normalizedRepeatedReviewFindingCount).toBe(0);
    expect(r?.reviewFindingKeyRepeatCount).toBe(1);
  });

  // ⛔ 회귀 — 빈 키는 «반복»이 아니다. 심볼이 없고 정규화가 빈 문자열을 내는 지적 둘은
  //   서로 «다른» 지적인데도 같은 `''` 키를 공유한다(실측 2026-08-24: 방어 전 keyRepeat=1).
  test('심볼이 없고 정규화가 비는 서로 다른 지적 둘은 키 축이 0 이다', () => {
    const r = measureReviewFindingRecurrence([f('id-curr', '   ')], [f('id-prev', '\t\n')]);
    expect(r?.reviewFindingKeyRepeatCount).toBe(0);
  });

  test('서로 다른 심볼을 인용하면 키 축은 0', () => {
    const previous = [f('id-prev', '`Foo.bar()` 가 쓰이지 않는다')];
    const current = [f('id-curr', '`Baz.qux()` 가 쓰이지 않는다')];
    const r = measureReviewFindingRecurrence(current, previous);
    expect(r?.normalizedRepeatedReviewFindingCount).toBe(0);
    expect(r?.reviewFindingKeyRepeatCount).toBe(0);
  });
});
