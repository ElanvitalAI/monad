import { describe, expect, test } from 'bun:test';

import { buildDashboardTurnPromptRuntime } from '../src/dashboard/turn-prompt-runtime.js';

describe('buildDashboardTurnPromptRuntime', () => {
  test('builds prompt-bank context and turn profile from user text', () => {
    const result = buildDashboardTurnPromptRuntime('please edit two files', 'dashboard:1', {
      promptBankConfig: {
        enabled: true,
        dashboardTurns: true,
        budgetTokens: 400,
        limit: 5,
        record: false,
      },
      chatModeState: {
        posture: 'general',
        mode: 'default',
        enteredAt: 0,
        intent: null,
        preferredSurfaceId: null,
        quickControlOnce: false,
      },
      buildPromptRuntimeState: (intents) => ({
        activeView: 'v1',
        focusedPane: 'log',
        visiblePanes: ['log'],
        activePlugins: [],
        loadedSkills: [],
        loadedWorkflows: [],
        onlineResources: [],
        intents,
        debugLevel: 'off',
        modelFamily: 'gpt',
        tags: [],
      }),
      getPromptBankStore: () => ({
        kind: 'sqlite',
        create: () => { throw new Error('unused'); },
        update: () => { throw new Error('unused'); },
        delete: () => { throw new Error('unused'); },
        get: () => null,
        list: () => [],
        search: () => [{
          id: 'ctx-live',
          name: 'Live Context',
          version: 1,
          scope: 'session',
          owner: 'test',
          kind: 'view-state',
          targetSlot: 'context',
          priority: 1,
          enabled: true,
          content: 'Window is compact.',
          tags: [],
          triggers: {},
          constraints: {},
          metadata: {},
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          useCount: 0,
        }],
        setEnabled: () => { throw new Error('unused'); },
        recordUse: () => {},
        recordInjection: () => { throw new Error('unused'); },
        getInjectionLog: () => null,
        listInjectionLogs: () => [],
      }),
      inspectActiveProvider: () => ({ model: 'gpt-5' }),
      getActivePluginName: () => 'sync',
    });

    expect(result.turnProfile.inputMode).toBe('general');
    expect(result.turnProfile.inputSource).toBeNull();
    expect(result.turnProfile.inputSourceKind).toBeNull();
    expect(result.promptBankContext).toContain('## Prompt Bank Context');
    expect(result.promptBankContext).toContain('Window is compact.');
  });

  test('skips prompt-bank context when dashboard prompt injection is disabled', () => {
    const result = buildDashboardTurnPromptRuntime('hello', 'dashboard:2', {
      promptBankConfig: {
        enabled: false,
        dashboardTurns: true,
        budgetTokens: 400,
        limit: 5,
        record: false,
      },
      chatModeState: {
        posture: 'control',
        mode: 'dashboard-control',
        enteredAt: 0,
        intent: 'fix',
        preferredSurfaceId: null,
        quickControlOnce: false,
      },
      buildPromptRuntimeState: () => ({
        intents: ['chat'],
      }),
      getPromptBankStore: () => {
        throw new Error('unused');
      },
      inspectActiveProvider: () => ({ model: 'gpt-5' }),
      getActivePluginName: () => undefined,
    });

    expect(result.promptBankContext).toBe('');
    expect(result.turnProfile.inputMode).toBe('control');
  });

  test('records input source in the turn profile when provided', () => {
    const result = buildDashboardTurnPromptRuntime('hello', 'dashboard:3', {
      promptBankConfig: {
        enabled: false,
        dashboardTurns: true,
        budgetTokens: 400,
        limit: 5,
        record: false,
      },
      chatModeState: {
        posture: 'general',
        mode: 'default',
        enteredAt: 0,
        intent: null,
        preferredSurfaceId: null,
        quickControlOnce: false,
      },
      buildPromptRuntimeState: () => ({
        intents: ['chat'],
      }),
      getPromptBankStore: () => {
        throw new Error('unused');
      },
      inspectActiveProvider: () => ({ model: 'gpt-5' }),
      getActivePluginName: () => undefined,
    }, {
      kind: 'voice',
      surface: 'dashboard-chat-main',
      mode: 'multi-turn',
      transcriptSource: 'voice',
      channel: 'dashboard',
    });

    expect(result.turnProfile.inputSourceKind).toBe('voice');
    expect(result.turnProfile.inputSource).toEqual({
      kind: 'voice',
      surface: 'dashboard-chat-main',
      mode: 'multi-turn',
      transcriptSource: 'voice',
      channel: 'dashboard',
    });
  });
});
