import { test, expect, describe } from 'bun:test';
import { internalSource, stampProvenance, allowAllEntitlement } from './agent-source.js';

describe('agent-source — 미래 확장 seam (C0 no-op)', () => {
  test('internalSource — origin internal · trust 1.0', () => {
    const s = internalSource('contract:samsung-capstone', '삼성 캡스톤');
    expect(s.origin).toBe('internal');
    expect(s.trust).toBe(1.0);
    expect(s.name).toBe('삼성 캡스톤');
    expect(s.id).toBe('contract:samsung-capstone');
  });

  test('stampProvenance — 소스 trust/origin 상속 + 수신시각', () => {
    const s = internalSource('contract:x');
    const p = stampProvenance(s, '2026-07-10T00:00:00Z');
    expect(p.sourceId).toBe('contract:x');
    expect(p.origin).toBe('internal');
    expect(p.trust).toBe(1.0);
    expect(p.receivedAt).toBe('2026-07-10T00:00:00Z');
  });

  test('allowAllEntitlement — C0 는 전부 허용(내부 전용)', () => {
    const s = internalSource('contract:x');
    expect(allowAllEntitlement.canConsume(s)).toBe(true);
    expect(allowAllEntitlement.canConsume(s, 'anyone')).toBe(true);
  });
});
