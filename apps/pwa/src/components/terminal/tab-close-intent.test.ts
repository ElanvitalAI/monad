import { describe, expect, test } from 'bun:test';

import { normalizeOwnerRunUsage, tabCloseAction, terminateConfirmation } from './tab-close-intent';

describe('tab close intent', () => {
  test('keeps the default close local and reserves destroy for explicit termination', () => {
    expect(tabCloseAction('remove-local')).toEqual({ action: 'remove-local', sendsDestroy: false });
    expect(tabCloseAction('terminate')).toEqual({ action: 'terminate', sendsDestroy: true });
  });

  test('normalizes missing and unrecognized owner usage to unknown', () => {
    expect(normalizeOwnerRunUsage(undefined)).toBe('unknown');
    expect(normalizeOwnerRunUsage('other')).toBe('unknown');
  });

  test('models every daemon owner usage for termination confirmation', () => {
    expect(terminateConfirmation('running').message).toContain('실행 중인 런이 이 터미널을 사용하고 있습니다');
    expect(terminateConfirmation('terminated-live-owner').message).toContain('소유 런은 종료됐지만');
    expect(terminateConfirmation('no-run-id').message).toContain('소유 런 정보가 없습니다');
  });

  test('warns that unknown usage cannot establish that nobody uses the terminal', () => {
    const confirmation = terminateConfirmation('unknown');
    expect(confirmation.message).toContain('사용 상태를 확인할 수 없습니다');
    expect(confirmation.message).toContain('아무도 쓰지 않는다고 단정할 수 없으며');
    expect(terminateConfirmation(undefined)).toEqual(confirmation);
  });
});
