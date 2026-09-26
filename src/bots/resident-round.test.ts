import { describe, expect, test } from 'bun:test';
import { decideResidentRound } from './resident-round.js';

const now = new Date('2026-09-07T10:00:00.000Z');

describe('decideResidentRound', () => {
  test('describes an overdue round as due with dedicated unattended provenance', () => {
    const scheduledAt = new Date('2026-09-07T09:59:59.000Z');
    const result = decideResidentRound({
      botName: 'investor',
      now,
      scheduledAt,
      universeRoot: '/tmp/elanous-a',
    });

    expect(result).toEqual({
      due: true,
      round: {
        botName: 'investor',
        scheduledAt,
        universeRoot: '/tmp/elanous-a',
        source: 'elanous-resident',
        humanInitiated: false,
      },
    });
    if (result.due) {
      expect(result.round.source).not.toBe('cron');
      expect(result.round.source).not.toBe('manual');
    }
  });

  test('does not describe a future schedule as due', () => {
    expect(decideResidentRound({
      botName: 'investor',
      now,
      scheduledAt: new Date('2026-09-07T10:00:01.000Z'),
      universeRoot: '/tmp/elanous-a',
    })).toEqual({ due: false });
  });

  test('preserves each caller-injected universe root without resolving one', () => {
    const scheduledAt = new Date('2026-09-07T10:00:00.000Z');
    const first = decideResidentRound({ botName: 'first', now, scheduledAt, universeRoot: '/isolated/a' });
    const second = decideResidentRound({ botName: 'second', now, scheduledAt, universeRoot: '/isolated/b' });

    expect(first).toMatchObject({ due: true, round: { universeRoot: '/isolated/a' } });
    expect(second).toMatchObject({ due: true, round: { universeRoot: '/isolated/b' } });
  });
});
