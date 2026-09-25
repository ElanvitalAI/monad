import { describe, expect, test } from 'bun:test';

import { interventionBadge } from './intervention-badge';

describe('interventionBadge', () => {
  test('keeps an owned high requested level without a downgrade marker', () => {
    const badge = interventionBadge({ level: 'L4', controlStance: 'owned' });

    expect(badge).toBe('개입 수준: L4');
    expect(badge).not.toContain('강등');
  });

  test.each([
    ['lost', '제어 소유권 상실'],
    ['unknown', '제어 소유권 미확인'],
  ] as const)('reports the %s control-stance downgrade reason', (controlStance, reason) => {
    expect(interventionBadge({ level: 'L4', controlStance }))
      .toBe(`개입 수준: L1 (요청 L4에서 강등: ${reason})`);
  });

  test.each(['L0', 'L1'] as const)('keeps the %s lower boundary with a non-owned stance', (level) => {
    expect(interventionBadge({ level, controlStance: 'lost' })).toBe(`개입 수준: ${level}`);
  });

  test('reports a missing level as unconfirmed rather than L0', () => {
    const badge = interventionBadge({ controlStance: 'owned' });

    expect(badge).toBe('개입 수준: 미확인');
    expect(badge).not.toContain('L0');
  });

  test('reports a missing control stance as unconfirmed rather than L0', () => {
    const badge = interventionBadge({ level: 'L4' });

    expect(badge).toBe('개입 수준: 미확인');
    expect(badge).not.toContain('L0');
  });

  test('reports both missing values as unconfirmed', () => {
    expect(interventionBadge({})).toBe('개입 수준: 미확인');
  });
});
