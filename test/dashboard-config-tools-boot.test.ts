import { afterEach, describe, expect, test } from 'bun:test';

import { bootDashboardConfigTools } from '../src/dashboard/config-tools-boot.js';
import {
  dispatchDashboardConfigGet,
  dispatchDashboardConfigSet,
  _resetDashboardConfigToolsForTesting,
  initDashboardConfigTools,
} from '../src/skills/tools/dashboard-config.js';

afterEach(() => {
  _resetDashboardConfigToolsForTesting();
});

describe('bootDashboardConfigTools', () => {
  test('wires config getters and persisted setters', async () => {
    const cfg: Record<string, any> = {
      dashboard: {
        promptBank: {
          budgetTokens: 1200,
          dashboardTurns: true,
          enabled: false,
          limit: 8,
          record: false,
          skillRuns: true,
        },
        theme: { active: 'paper' },
      },
      input: { maxLines: 3 },
    };
    let chatOnly = false;
    let previewSource = 'smart';
    let showHidden = false;
    let sortMode = 'name';
    let draws = 0;
    let saveCount = 0;

    bootDashboardConfigTools({
      initDashboardConfigTools,
      approver: async () => true,
      getChatOnlyMode: () => chatOnly,
      applyChatOnlyMode: (enabled) => { chatOnly = enabled; draws += 1; },
      getUserConfig: () => cfg,
      saveUserConfig: () => { saveCount += 1; },
      getPreviewSource: () => previewSource as any,
      applyPreviewSource: (source) => { previewSource = source; draws += 1; },
      getWorkingDirShowHidden: () => showHidden,
      applyWorkingDirShowHidden: (enabled) => { showHidden = enabled; draws += 1; },
      getWorkingDirSortMode: () => sortMode,
      applyWorkingDirSortMode: (mode) => { sortMode = mode; draws += 1; },
      afterThemeActiveSaved: () => { draws += 1; },
    });

    const getResult = await dispatchDashboardConfigGet({ key: 'dashboard.theme.active' });
    expect(getResult.output).toContain('paper');

    await dispatchDashboardConfigSet({ key: 'dashboard.promptBank.limit', value: 12 });
    await dispatchDashboardConfigSet({ key: 'input.maxLines', value: 5 });
    await dispatchDashboardConfigSet({ key: 'dashboard.theme.active', value: 'ink' });

    expect(cfg.dashboard.promptBank.limit).toBe(12);
    expect(cfg.input.maxLines).toBe(5);
    expect(cfg.dashboard.theme.active).toBe('ink');
    expect(saveCount).toBe(3);
    expect(draws).toBe(1);
  });

  test('wires host-side apply paths for chat, preview, and working dir toggles', async () => {
    const cfg: Record<string, any> = {
      dashboard: {
        promptBank: {
          budgetTokens: 1200,
          dashboardTurns: true,
          enabled: false,
          limit: 8,
          record: false,
          skillRuns: true,
        },
        theme: { active: 'paper' },
      },
      input: { maxLines: 3 },
    };
    let chatOnly = false;
    let previewSource = 'smart';
    let showHidden = false;
    let sortMode = 'name';
    const events: string[] = [];

    bootDashboardConfigTools({
      initDashboardConfigTools,
      approver: async () => true,
      getChatOnlyMode: () => chatOnly,
      applyChatOnlyMode: (enabled) => { chatOnly = enabled; events.push(`chat:${enabled}`); },
      getUserConfig: () => cfg,
      saveUserConfig: () => {},
      getPreviewSource: () => previewSource as any,
      applyPreviewSource: (source) => { previewSource = source; events.push(`preview:${source}`); },
      getWorkingDirShowHidden: () => showHidden,
      applyWorkingDirShowHidden: (enabled) => { showHidden = enabled; events.push(`hidden:${enabled}`); },
      getWorkingDirSortMode: () => sortMode,
      applyWorkingDirSortMode: (mode) => { sortMode = mode; events.push(`sort:${mode}`); },
      afterThemeActiveSaved: () => {},
    });

    await dispatchDashboardConfigSet({ key: 'dashboard.chatOnlyMode', value: true });
    await dispatchDashboardConfigSet({ key: 'preview.source', value: 'wd' });
    await dispatchDashboardConfigSet({ key: 'workingDir.showHidden', value: true });
    await dispatchDashboardConfigSet({ key: 'workingDir.sortMode', value: 'mtime' });

    expect(chatOnly).toBe(true);
    expect(previewSource).toBe('wd');
    expect(showHidden).toBe(true);
    expect(sortMode).toBe('mtime');
    expect(events).toEqual([
      'chat:true',
      'preview:wd',
      'hidden:true',
      'sort:mtime',
    ]);
  });
});
