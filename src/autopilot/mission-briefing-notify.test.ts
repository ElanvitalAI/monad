import { test, expect, describe } from 'bun:test';
import { buildBriefingCallbackData, parseBriefingCallbackData, briefingButtonRow, hitlToken } from './mission-notify.js';
import { presentMissionBriefing } from './mission-briefing-notify.js';

describe('브리핑 콜백 라운드트립(B3·#4234 교훈)', () => {
  test('build→parse 라운드트립 — arm/react/hold 전부', () => {
    for (const action of ['arm', 'react', 'hold'] as const) {
      const data = buildBriefingCallbackData('apm_deadbeef', action);
      const parsed = parseBriefingCallbackData(data);
      expect(parsed).not.toBeNull();
      expect(parsed!.action).toBe(action);
      expect(parsed!.token).toBe(hitlToken('apm_deadbeef'));
    }
  });

  test('parse 는 브리핑 콜백만 — 다른 네임스페이스는 null', () => {
    expect(parseBriefingCallbackData('apm-life:tok:pause')).toBeNull();
    expect(parseBriefingCallbackData('apm-phase:key:arm')).toBeNull();
    expect(parseBriefingCallbackData('apm-brief:tok:bogus')).toBeNull();
  });

  test('briefingButtonRow — 3버튼(승인/재조치/보류)·64byte 내', () => {
    const row = briefingButtonRow('apm_x');
    expect(row.length).toBe(3);
    expect(row.map((b) => b.text)).toEqual(['✅ 최종 승인', '✏️ 재조치', '❌ 보류']);
    for (const b of row) expect(Buffer.byteLength(b.data)).toBeLessThanOrEqual(64);
  });
});

describe('presentMissionBriefing — 발송 게이트(B3)', () => {
  test('origin 없으면 미발송이나 브리핑은 합성·관측(fail-soft)', () => {
    const r = presentMissionBriefing(null, 'apm_missing', { grounded: false });
    expect(r.sent).toBe(false);
    expect(r.attached).toBe(false);
    expect(r.briefing.missionId).toBe('apm_missing');
  });

  test('non-telegram origin 도 미발송', () => {
    const r = presentMissionBriefing({ channel: 'discord' } as never, 'apm_missing', { grounded: false });
    expect(r.sent).toBe(false);
  });
});
