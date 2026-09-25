// ── PX-6 P6: /plugins active CLI formatter ──

import { describe, test, expect } from 'bun:test';
import { formatActivePluginsTable, type ActivePluginSummary } from '../src/plugins/core/multi-active';

describe('PX-6 P6 — formatActivePluginsTable', () => {
  test('empty list → "(no plugins active)"', () => {
    expect(formatActivePluginsTable([])).toBe('(no plugins active)');
  });

  test('single plugin → header + row', () => {
    const now = Date.now();
    const summaries: ActivePluginSummary[] = [
      { id: 'sync', allowMultiActive: false, activatedAt: now - 30_000 },
    ];
    const out = formatActivePluginsTable(summaries);
    expect(out).toContain('id');
    expect(out).toContain('sync');
    expect(out).toContain('no');
    expect(out).toMatch(/30s|29s|31s/);
  });

  test('multi plugins + quota render', () => {
    const now = Date.now();
    const summaries: ActivePluginSummary[] = [
      { id: 'agent-team', allowMultiActive: true, activatedAt: now - 125_000 },
      {
        id: 'auto-research', allowMultiActive: true, activatedAt: now - 1000,
        quota: {
          ptySpawns: { used: 2, cap: 4 },
          concurrentSubagents: { used: 1, cap: 2 },
          tokensPerTurn: { used: 45_000, cap: undefined },
        },
      },
    ];
    const out = formatActivePluginsTable(summaries);
    expect(out).toContain('agent-team');
    expect(out).toContain('auto-research');
    expect(out).toContain('yes');
    expect(out).toContain('pty 2/4');
    expect(out).toContain('sub 1/2');
    // tokensPerTurn cap undefined → omitted from the compact string
    expect(out).not.toContain('tok');
  });

  test('quota completely unlimited → "—"', () => {
    const summaries: ActivePluginSummary[] = [{
      id: 'x', allowMultiActive: true, activatedAt: Date.now(),
      quota: {
        ptySpawns: { used: 0, cap: undefined },
        concurrentSubagents: { used: 0, cap: undefined },
        tokensPerTurn: { used: 0, cap: undefined },
      },
    }];
    const out = formatActivePluginsTable(summaries);
    expect(out).toContain('—');
  });

  test('row columns are padded to equal width', () => {
    const now = Date.now();
    const summaries: ActivePluginSummary[] = [
      { id: 'short', allowMultiActive: true, activatedAt: now },
      { id: 'way-longer-name', allowMultiActive: false, activatedAt: now },
    ];
    const out = formatActivePluginsTable(summaries);
    const lines = out.split('\n');
    // header + 2 rows
    expect(lines.length).toBe(3);
    // all non-empty rows same length
    const first = lines[1]!.length;
    expect(lines[2]!.length).toBe(first);
  });
});
