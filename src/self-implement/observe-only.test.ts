import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDevCliSpec } from '../self-dev/dev-cli.js';
import { elanousTuiSpawnOptions } from './elanous-tui-spawn.js';
import {
  OBSERVE_ONLY_FLAG_ENV,
  _setObserveOnlyConfigReaderForTesting,
  resolveObserveOnlyDecision,
} from './observe-only.js';

afterEach(() => _setObserveOnlyConfigReaderForTesting());

describe('self-implement observe-only decision and child boot propagation', () => {
  test('distinguishes flag, config, and unchanged default decisions', () => {
    _setObserveOnlyConfigReaderForTesting(() => false);
    expect(resolveObserveOnlyDecision({ [OBSERVE_ONLY_FLAG_ENV]: '1' })).toEqual({ enabled: true, source: 'flag' });
    expect(resolveObserveOnlyDecision({})).toEqual({ enabled: false, source: 'default' });

    _setObserveOnlyConfigReaderForTesting(() => true);
    expect(resolveObserveOnlyDecision({})).toEqual({ enabled: true, source: 'config' });
  });

  test('elanous dev option reaches the isolated child spawn environment before boot', () => {
    const spec = buildDevCliSpec({ text: 'ignored' }, { kind: 'self' }, {
      elanous: true, goal: 'observe', observeOnly: true,
    });
    expect(spec.elanous).toMatchObject({ goal: 'observe', observeOnly: true });

    const root = mkdtempSync(join(tmpdir(), 'observe-only-child-'));
    try {
      mkdirSync(join(root, 'config'));
      mkdirSync(join(root, 'state'));
      const spawn = elanousTuiSpawnOptions({
        repoRoot: '/repo', cwd: root,
        configDir: realpathSync(join(root, 'config')),
        stateDir: realpathSync(join(root, 'state')),
        observeOnly: spec.elanous?.observeOnly,
        space: { inHarness: true, kind: 'self-implement', id: 'observe-only', runId: '' },
      });
      expect(spawn.env?.[OBSERVE_ONLY_FLAG_ENV]).toBe('1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('breaking child flag propagation fails the named boot invariant', () => {
    _setObserveOnlyConfigReaderForTesting(() => false);
    expect(() => {
      const decision = resolveObserveOnlyDecision({});
      expect(decision).toEqual({ enabled: true, source: 'flag' });
    }).toThrow('"source": "flag"');
  });
});
