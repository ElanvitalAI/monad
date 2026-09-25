import { describe, expect, test } from 'bun:test';

import { shouldPassthroughDashboardHostOwnedInputCoreAction } from '../src/dashboard/input/input-core-host-action.js';

describe('shouldPassthroughDashboardHostOwnedInputCoreAction', () => {
  test('keeps app.quit on the dashboard host path', () => {
    expect(shouldPassthroughDashboardHostOwnedInputCoreAction('app.quit')).toBe(true);
  });

  test('does not passthrough unrelated input-core actions', () => {
    expect(shouldPassthroughDashboardHostOwnedInputCoreAction('modal.cancel')).toBe(false);
    expect(shouldPassthroughDashboardHostOwnedInputCoreAction('pane.focus.log')).toBe(false);
  });
});
