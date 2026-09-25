import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PluginTrustStore } from '../src/plugins/core/trust-store.js';

describe('PluginTrustStore', () => {
  test('persists trust records', () => {
    const root = mkdtempSync(join(tmpdir(), 'monad-plugin-trust-'));
    try {
      const path = join(root, 'trust.json');
      const store = new PluginTrustStore(path);
      store.setTrusted('workspace.demo', 'workspace', true, new Date('2026-04-17T00:00:00Z'));

      const reloaded = new PluginTrustStore(path);
      expect(reloaded.isTrusted('workspace.demo', 'workspace')).toBe(true);
      expect(reloaded.list()).toEqual([{
        pluginId: 'workspace.demo',
        scope: 'workspace',
        trusted: true,
        updatedAt: '2026-04-17T00:00:00.000Z',
      }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
