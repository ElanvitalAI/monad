import { describe, expect, test } from 'bun:test';
import {
  dashboardSetupHelpLines,
  resolveDashboardChatMainSetupCommand,
} from '../src/dashboard/input/chat-main-setup-command.js';

describe('/setup command resolver', () => {
  test('default route opens inline category picker', () => {
    expect(resolveDashboardChatMainSetupCommand([])).toEqual({ kind: 'inline' });
  });

  test('provider and discord map to inline targets', () => {
    expect(resolveDashboardChatMainSetupCommand(['provider'])).toEqual({
      kind: 'inline',
      target: 'provider',
    });
    expect(resolveDashboardChatMainSetupCommand(['discord'])).toEqual({
      kind: 'inline',
      target: 'discord',
    });
  });

  test('legacy onboarding steps still route to popup launch', () => {
    expect(resolveDashboardChatMainSetupCommand(['llm'])).toEqual({
      kind: 'launch',
      step: 'llm',
    });
  });

  test('help text documents inline and legacy paths', () => {
    const lines = dashboardSetupHelpLines().join('\n');
    expect(lines).toContain('/setup provider');
    expect(lines).toContain('/setup discord');
    expect(lines).toContain('legacy step');
  });
});
