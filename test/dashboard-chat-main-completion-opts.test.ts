import { describe, expect, test } from 'bun:test';

import { createDashboardChatMainCompletionOpts } from '../src/dashboard/input/chat-main-completion-opts.js';

describe('dashboard chat main completion opts', () => {
  const opts = createDashboardChatMainCompletionOpts({
    getVisibleSkills: () => [
      { name: 'alpha-skill', description: 'Alpha first line\nextra detail' },
      { name: 'beta-tool', description: 'Beta summary' },
    ],
    listPlugins: () => [
      { plugin: { name: 'sync', description: 'Sync plugin', version: '1.2.3' }, source: 'local' },
    ],
    listContextDrops: () => [
      { id: 7, token: '[PDF #7]', filename: 'report.pdf' },
    ],
  });

  test('suggests plugin names for activation and reload subcommands', async () => {
    await expect(opts.getArgSuggestions?.('plugin', ['activate'])).resolves.toEqual([
      { value: 'sync', description: 'Sync plugin (v1.2.3, local)' },
    ]);
  });

  test('suggests context attachment ids for drop subcommand', async () => {
    await expect(opts.getArgSuggestions?.('context', ['drop'])).resolves.toEqual([
      { value: '7', description: '[PDF #7] report.pdf' },
    ]);
  });

  test('suggests visible skills for run-skill entry', async () => {
    await expect(opts.getArgSuggestions?.('run-skill', [])).resolves.toEqual([
      { value: 'alpha-skill', description: 'Alpha first line' },
      { value: 'beta-tool', description: 'Beta summary' },
    ]);
  });

  test('ranks skill candidates by prefix match then name', async () => {
    await expect(opts.getSkillCandidates?.('al')).resolves.toEqual([
      { name: 'alpha-skill', description: 'Alpha first line' },
    ]);
  });
});
