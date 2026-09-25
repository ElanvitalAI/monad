// 시각 표시 계약 테스트 — 전부 timeZone 을 **명시 주입**한다.
// 실행 머신 TZ 에 의존하는 테스트는 CI 에서 조용히 깨지거나(더 나쁘게) 버그를
// 정답으로 못 박는다. 실제로 `cli/logs-cli.test.ts` 가 UTC slice 결과를 하드코딩해
// 9시간 오차를 스펙으로 잠그고 있었고, `domains/cron-match.test.ts:31` 은 개발 머신이
// KST 라는 전제를 암묵 의존한다.

import { describe, test, expect } from 'bun:test';
import {
  formatClock,
  dateKey,
  formatDateTime,
  formatShortDateTime,
  calendarFields,
  resolveTimeZone,
} from './format.js';

// 2026-07-24T01:06:00.202Z = KST 10:06, UTC 01:06 — 날짜는 같지만 시각이 9시간 차.
const ISO = '2026-07-24T01:06:00.202Z';
// 2026-07-23T22:45:00Z = KST 07:45(7/24), UTC 22:45(7/23) — **날짜가 다르다**.
// 아침 브리핑 시각이 정확히 이 경계에 있다(morning-report.ts:33 주석 참조).
const ISO_DATE_BOUNDARY = '2026-07-23T22:45:00.000Z';

describe('formatter cache', () => {
  test('같은 시간대와 옵션의 calendarFields는 포매터를 한 번만 만든다', () => {
    const original = Intl.DateTimeFormat;
    let constructions = 0;
    Intl.DateTimeFormat = new Proxy(original, {
      construct(target, args, newTarget) {
        constructions++;
        return Reflect.construct(target, args, newTarget);
      },
    });
    try {
      for (let i = 0; i < 1_000; i++) calendarFields(ISO, { timeZone: 'Asia/Seoul' });
      expect(constructions).toBe(1);
    } finally {
      Intl.DateTimeFormat = original;
    }
  });

  test('UTC와 KST 포매터 캐시는 서로 섞이지 않는다', () => {
    expect(formatClock(ISO, { timeZone: 'UTC' })).toBe('01:06:00');
    expect(formatClock(ISO, { timeZone: 'Asia/Seoul' })).toBe('10:06:00');
    expect(formatClock(ISO, { timeZone: 'UTC' })).toBe('01:06:00');
    expect(formatClock(ISO, { timeZone: 'Asia/Seoul' })).toBe('10:06:00');
  });
});

describe('formatClock', () => {
  test('시간대에 따라 시각이 달라진다 (UTC ↔ KST 9시간)', () => {
    expect(formatClock(ISO, { timeZone: 'UTC' })).toBe('01:06:00');
    expect(formatClock(ISO, { timeZone: 'Asia/Seoul' })).toBe('10:06:00');
    expect(formatClock(ISO, { timeZone: 'America/New_York' })).toBe('21:06:00');
  });

  test('millis 옵션', () => {
    expect(formatClock(ISO, { timeZone: 'Asia/Seoul', millis: true })).toBe('10:06:00.202');
  });

  test('24시간제 — 자정/정오가 00/12 로 나온다(12시간제 오염 없음)', () => {
    expect(formatClock('2026-07-24T15:00:00Z', { timeZone: 'Asia/Seoul' })).toBe('00:00:00');
    expect(formatClock('2026-07-24T03:00:00Z', { timeZone: 'Asia/Seoul' })).toBe('12:00:00');
  });

  test('epoch ms · Date 도 받는다', () => {
    const ms = Date.parse(ISO);
    expect(formatClock(ms, { timeZone: 'Asia/Seoul' })).toBe('10:06:00');
    expect(formatClock(new Date(ms), { timeZone: 'Asia/Seoul' })).toBe('10:06:00');
  });

  test('파싱 불가 입력은 원본 반환 — 표시 함수가 화면을 깨뜨리면 안 된다', () => {
    expect(formatClock('not-a-date', { timeZone: 'UTC' })).toBe('not-a-date');
    expect(formatClock('', { timeZone: 'UTC' })).toBe('');
  });
});

describe('dateKey — 집계 키 (UTC 로 뽑으면 KST 00~09시가 전날로 샌다)', () => {
  test('★ 날짜 경계: 같은 순간이 UTC 는 7/23, KST 는 7/24', () => {
    expect(dateKey(ISO_DATE_BOUNDARY, { timeZone: 'UTC' })).toBe('2026-07-23');
    expect(dateKey(ISO_DATE_BOUNDARY, { timeZone: 'Asia/Seoul' })).toBe('2026-07-24');
  });

  test('경계 아닌 시각은 양쪽 동일', () => {
    expect(dateKey(ISO, { timeZone: 'UTC' })).toBe('2026-07-24');
    expect(dateKey(ISO, { timeZone: 'Asia/Seoul' })).toBe('2026-07-24');
  });

  test('en-CA 관례와 동일한 YYYY-MM-DD (morning-report.ts:33 과 정합)', () => {
    const legacy = new Date(ISO_DATE_BOUNDARY).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    expect(dateKey(ISO_DATE_BOUNDARY, { timeZone: 'Asia/Seoul' })).toBe(legacy);
  });
});

describe('formatDateTime · formatShortDateTime', () => {
  test('YYYY-MM-DD HH:MM', () => {
    expect(formatDateTime(ISO, { timeZone: 'Asia/Seoul' })).toBe('2026-07-24 10:06');
    expect(formatDateTime(ISO, { timeZone: 'UTC' })).toBe('2026-07-24 01:06');
  });

  test('seconds 옵션', () => {
    expect(formatDateTime(ISO, { timeZone: 'Asia/Seoul', seconds: true })).toBe('2026-07-24 10:06:00');
  });

  test('MM-DD HH:MM — 날짜 경계에서 날짜도 같이 움직인다', () => {
    expect(formatShortDateTime(ISO_DATE_BOUNDARY, { timeZone: 'UTC' })).toBe('07-23 22:45');
    expect(formatShortDateTime(ISO_DATE_BOUNDARY, { timeZone: 'Asia/Seoul' })).toBe('07-24 07:45');
  });
});

// ⚠️ 이 describe 는 `process.env.TZ` 를 **절대 변이하지 않는다**. 실측 결과 되돌릴 수
// 없기 때문이다: TZ='UTC' 설정 → delete → 여전히 UTC. 런타임이 마지막 값을 유지해
// 같은 프로세스의 후속 테스트 파일이 전부 오염된다(이 세션에서 catch-up 테스트 4건이
// 실제로 그렇게 깨졌고, 파일 순서를 뒤집으면 통과했다). 그래서 주입 seam 으로 검증한다.
describe('resolveTimeZone — config → env → OS → UTC', () => {
  test('유효한 시간대와 출처를 돌려준다', () => {
    const r = resolveTimeZone();
    expect(typeof r.timeZone).toBe('string');
    expect(r.timeZone.length).toBeGreaterThan(0);
    expect(['config', 'env', 'system', 'fallback']).toContain(r.source);
    // 해석 결과는 반드시 Intl 이 받아들이는 값이어야 한다.
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: r.timeZone })).not.toThrow();
  });

  test('우선순위: config > env > system', () => {
    expect(resolveTimeZone({
      configTimeZone: 'Asia/Seoul', envTimeZone: 'UTC', systemTimeZone: 'America/New_York',
    })).toEqual({ timeZone: 'Asia/Seoul', source: 'config' });

    expect(resolveTimeZone({
      configTimeZone: undefined, envTimeZone: 'UTC', systemTimeZone: 'America/New_York',
    })).toEqual({ timeZone: 'UTC', source: 'env' });

    expect(resolveTimeZone({
      configTimeZone: undefined, envTimeZone: undefined, systemTimeZone: 'America/New_York',
    })).toEqual({ timeZone: 'America/New_York', source: 'system' });
  });

  test('★ env 가 비어도 OS 로 살아난다 — launchd 데몬이 TZ 를 못 물려받는 경우', () => {
    expect(resolveTimeZone({
      configTimeZone: undefined, envTimeZone: undefined, systemTimeZone: 'Asia/Seoul',
    })).toEqual({ timeZone: 'Asia/Seoul', source: 'system' });
  });

  test('잘못된 값은 무시하고 다음 후보로 — 오타가 표시를 깨뜨리지 않는다', () => {
    expect(resolveTimeZone({
      configTimeZone: 'Not/AZone', envTimeZone: 'Also/Bogus', systemTimeZone: 'Asia/Seoul',
    })).toEqual({ timeZone: 'Asia/Seoul', source: 'system' });
  });

  test('전부 무효면 UTC — 지역을 기본값으로 하드코딩하지 않는다', () => {
    expect(resolveTimeZone({
      configTimeZone: undefined, envTimeZone: undefined, systemTimeZone: 'Not/AZone',
    })).toEqual({ timeZone: 'UTC', source: 'fallback' });
  });
});
