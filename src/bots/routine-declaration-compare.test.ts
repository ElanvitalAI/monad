import { describe, expect, test } from 'bun:test';
import { parsePluginManifest, type PluginTaskContribution } from '../plugins/core/manifest.js';
import { compareRoutineDeclarations } from './routine-declaration-compare.js';
import { parseBotlabCron } from './routines.js';

const CRON = [
  '50 7 * * * bun scripts/botlab/bot-routine.ts investor',
  '30 7 * * * bun scripts/botlab/bot-routine.ts assistant',
  '0 8 * * * bun scripts/botlab/bot-routine.ts newsbot',
].join('\n');

const MAC_CRON = [
  '50 7 * * * bun scripts/botlab/bot-routine.ts investor',
  '30 7 * * * bun scripts/botlab/bot-routine.ts assistant',
].join('\n');

const VM_CRON = '0 8 * * * bun scripts/botlab/bot-routine.ts newsbot';

function tasks(bots: readonly string[]): PluginTaskContribution[] {
  return bots.map((bot) => ({
    id: `routine-${bot}`,
    command: 'bun',
    args: ['scripts/botlab/bot-routine.ts', bot],
  }));
}

test('botlab manifest declares the three routine tasks without executing them', async () => {
  const raw = JSON.parse(await Bun.file('plugins/botlab/plugin.json').text());
  const manifest = parsePluginManifest(raw);
  const declarations = manifest.contributes.tasks ?? [];

  expect(declarations.map((task) => [task.command, task.args]).sort()).toEqual([
    ['bun', ['scripts/botlab/bot-routine.ts', 'assistant']],
    ['bun', ['scripts/botlab/bot-routine.ts', 'investor']],
    ['bun', ['scripts/botlab/bot-routine.ts', 'newsbot']],
  ]);
});

describe('compareRoutineDeclarations', () => {
  test('matches the mac host scope while ignoring the VM manifest bot', () => {
    expect(compareRoutineDeclarations(parseBotlabCron(MAC_CRON), tasks(['investor', 'assistant', 'newsbot']), ['investor', 'assistant']))
      .toEqual({ kind: 'same' });
  });

  test('matches the VM host scope while ignoring the mac manifest bots', () => {
    expect(compareRoutineDeclarations(parseBotlabCron(VM_CRON), tasks(['investor', 'assistant', 'newsbot']), ['newsbot']))
      .toEqual({ kind: 'same' });
  });

  test('names a host bot missing from plugin contributions', () => {
    expect(compareRoutineDeclarations(parseBotlabCron(CRON), tasks(['investor', 'assistant']), ['investor', 'assistant', 'newsbot']))
      .toEqual({ kind: 'different', bots: ['newsbot'] });
  });

  test('ignores a manifest bot not active on this host', () => {
    expect(compareRoutineDeclarations(parseBotlabCron(MAC_CRON), tasks(['investor', 'assistant', 'newsbot']), ['investor', 'assistant']))
      .toEqual({ kind: 'same' });
  });

  test('names the host bot whose invocation script differs', () => {
    const declarations = tasks(['investor', 'assistant', 'newsbot']);
    declarations[1] = { ...declarations[1], args: ['scripts/botlab/other-routine.ts', 'assistant'] };

    expect(compareRoutineDeclarations(parseBotlabCron(CRON), declarations, ['assistant']))
      .toEqual({ kind: 'different', bots: ['assistant'] });
  });

  test('preserves an unread crontab as unmeasured rather than different', () => {
    expect(compareRoutineDeclarations(parseBotlabCron(null), tasks(['investor', 'assistant', 'newsbot']), ['investor']))
      .toEqual({
        kind: 'unmeasured',
        why: 'crontab 을 «못 물었다» — ⛔ 「예약이 없다」가 아니다',
      });
  });
});
