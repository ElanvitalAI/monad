import { describe, expect, test } from 'bun:test';

import { chooseAcpPermissionOption } from '../src/acp/client.js';

describe('ACP permission option selection', () => {
  const options = [
    { optionId: 'reject-always', name: 'Reject always', kind: 'reject_always' as const },
    { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' as const },
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' as const },
    { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' as const },
  ];

  test('approval prefers allow_once over allow_always', () => {
    expect(chooseAcpPermissionOption(options, true)).toBe('allow-once');
  });

  test('rejection prefers reject_once over reject_always', () => {
    expect(chooseAcpPermissionOption(options, false)).toBe('reject-once');
  });

  test('returns null when the requested direction has no matching option', () => {
    expect(chooseAcpPermissionOption(options.filter(o => !o.kind.startsWith('allow')), true)).toBe(null);
    expect(chooseAcpPermissionOption(options.filter(o => !o.kind.startsWith('reject')), false)).toBe(null);
  });
});
