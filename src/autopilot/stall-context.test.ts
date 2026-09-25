import { describe, expect, test } from 'bun:test';
import { formatStallContext } from './stall-context.js';

describe('formatStallContext', () => {
  test('값이 없으면 빈 문자열', () => {
    expect(formatStallContext({})).toBe('');
  });

  test('긴 정지를 초와 분으로 사람이 읽게 포맷한다', () => {
    expect(formatStallContext({ sameScreenMs: 464_190, stallRung: 2 })).toBe('화면 무변화: 464초(7분 44초) · stall 사다리 2단');
  });

  test('rung -1은 stall 표기를 하지 않는다', () => {
    expect(formatStallContext({ sameScreenMs: 1_500, stallRung: -1 })).toBe('화면 무변화: 1초');
  });

  // ⓘ 계약 명시(사후 리뷰 should-fix) — `stallRung` 만 있고 `sameScreenMs` 가 없는 경우.
  //   드라이버는 항상 둘을 함께 채우지만, 이 함수는 **부분 입력에서도 정의된 동작**을 가져야 한다
  //   (다른 소비자가 rung 만 알 수 있다). rung 은 그 자체로 의미 있는 신호이므로 출력한다.
  test('rung 만 있어도(sameScreenMs 부재) 그 신호는 출력한다', () => {
    expect(formatStallContext({ stallRung: 1 })).toBe('stall 사다리 1단');
    expect(formatStallContext({ stallRung: -1 })).toBe('');      // stall 아님 = 할 말 없음
  });

  test('sameScreenMs 만 있어도(rung 부재) 시간은 출력한다', () => {
    expect(formatStallContext({ sameScreenMs: 61_000 })).toBe('화면 무변화: 61초(1분 1초)');
  });
});
