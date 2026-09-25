import { describe, expect, test } from 'bun:test';
import provider, {
  createOpenPullRequestCountProvider,
  openPullRequestListLimit,
  parseOpenPullRequestSnapshot,
  probeOpenPullRequestCount,
  readOpenPullRequestSnapshot,
} from '../../src/mission-capabilities/report/openprcount.js';
import { probeCapability, resolveCapabilityProvider } from '../../src/mission-capabilities/registry.js';

describe('report.openprcount', () => {
  test('empty or malformed external state is degraded with a repair target', () => {
    const degraded = probeOpenPullRequestCount(() => '');
    expect(degraded.ok).toBe(false);
    if (degraded.ok) throw new Error('An empty snapshot must not be reported as available.');
    expect(degraded.reason).toContain('missing, malformed, or truncated');
    expect(degraded.repairHint.paths).toEqual(['src/mission-capabilities/report/openprcount.ts']);
  });

  test('a populated open pull-request snapshot is available', () => {
    expect(probeOpenPullRequestCount(() => '[{"number":42,"state":"OPEN"}]')).toEqual({ ok: true });
    expect(parseOpenPullRequestSnapshot('[]')).toEqual([]);
  });

  test('a snapshot at the listing limit is degraded instead of silently counted as complete', () => {
    const truncated = JSON.stringify(Array.from({ length: openPullRequestListLimit }, (_, index) => ({ number: index + 1, state: 'OPEN' })));
    expect(probeOpenPullRequestCount(() => truncated).ok).toBe(false);
  });

  test('passes the supplied authority root as the snapshot command cwd', () => {
    const authorityRoot = '/authority/root';
    const alternateRoot = '/alternate/root';
    let observedCwd: string | undefined;
    const execFile = (_file: string, _args: readonly string[], options: { cwd?: string }) => {
      observedCwd = options.cwd;
      return '[{"number":42,"state":"OPEN"}]';
    };

    expect(process.cwd()).not.toBe(authorityRoot);
    expect(process.cwd()).not.toBe(alternateRoot);
    expect(parseOpenPullRequestSnapshot(readOpenPullRequestSnapshot(authorityRoot, execFile as never))).toHaveLength(1);
    expect(observedCwd).toBe(authorityRoot);
  });

  test('the path-based resolver reaches the provider without registry wiring', async () => {
    const resolved = await resolveCapabilityProvider('report.openprcount');
    if (!resolved) throw new Error('The path-based capability resolver did not find report.openprcount.');
    expect(resolved.id).toBe(provider.id);

    const supplied = createOpenPullRequestCountProvider(() => '[{"number":7,"state":"OPEN"}]');
    expect(await supplied.probe()).toEqual({ ok: true });
    expect(await probeCapability('report.openprcount')).toEqual(await provider.probe());
  });
});
