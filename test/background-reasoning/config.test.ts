// Y2 config loader · file > env > default hierarchy.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_BACKGROUND_REASONING_CONFIG,
  loadBackgroundReasoningConfig,
} from '../../src/background-reasoning/config';

function withTmpYaml(contents: string, fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'bg-cfg-'));
  const path = join(dir, 'budget.yaml');
  writeFileSync(path, contents, 'utf-8');
  try { fn(path); } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('background-reasoning config loader', () => {
  test('absent file → defaults', () => {
    const cfg = loadBackgroundReasoningConfig({ path: '/nonexistent/path.yaml', env: {} });
    expect(cfg).toEqual(DEFAULT_BACKGROUND_REASONING_CONFIG);
  });

  test('parses §5.4 yaml shape', () => {
    withTmpYaml(
      `budget:\n  monthly_cloud_max_usd: 50\n  warn_threshold: "90%"\n  patcher_cloud_allowed: true\n  thinker_cloud_allowed: false\n  emergency_cloud_always: false\n  user_active_cpu_threshold: 0.5\n  max_local_slots: 3\n`,
      (path) => {
        const cfg = loadBackgroundReasoningConfig({ path, env: {} });
        expect(cfg.monthlyCloudMaxUsd).toBe(50);
        expect(cfg.warnThreshold).toBeCloseTo(0.9);
        expect(cfg.patcherCloudAllowed).toBe(true);
        expect(cfg.thinkerCloudAllowed).toBe(false);
        expect(cfg.emergencyCloudAlways).toBe(false);
        expect(cfg.userActiveCpuThreshold).toBe(0.5);
        expect(cfg.maxLocalSlots).toBe(3);
      },
    );
  });

  test('warn_threshold numeric > 1 normalizes to ratio', () => {
    withTmpYaml(`budget:\n  warn_threshold: 75\n`, (path) => {
      const cfg = loadBackgroundReasoningConfig({ path, env: {} });
      expect(cfg.warnThreshold).toBeCloseTo(0.75);
    });
  });

  test('malformed yaml → defaults', () => {
    withTmpYaml('budget: : :', (path) => {
      const cfg = loadBackgroundReasoningConfig({ path, env: {} });
      expect(cfg).toEqual(DEFAULT_BACKGROUND_REASONING_CONFIG);
    });
  });

  test('env overrides yaml', () => {
    withTmpYaml(`budget:\n  monthly_cloud_max_usd: 20\n  patcher_cloud_allowed: false\n`, (path) => {
      const cfg = loadBackgroundReasoningConfig({
        path,
        env: {
          MONAD_BG_MONTHLY_CLOUD_MAX_USD: '99',
          MONAD_BG_PATCHER_CLOUD_ALLOWED: 'true',
          MONAD_BG_THINKER_CLOUD_ALLOWED: 'false',
        },
      });
      expect(cfg.monthlyCloudMaxUsd).toBe(99);
      expect(cfg.patcherCloudAllowed).toBe(true);
      expect(cfg.thinkerCloudAllowed).toBe(false);
    });
  });
});
