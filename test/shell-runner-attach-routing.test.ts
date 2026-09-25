import { describe, expect, test } from 'bun:test';

import { decideAttach } from '../src/shell-runner/attach-routing.js';
import type { AttachRoutingDeps } from '../src/shell-runner/attach-routing.js';

const depsNone: AttachRoutingDeps = {
  getVwLabel: () => null,
  resolveVwIdByLabel: () => null,
};

const depsHit = (label: string, id: number): AttachRoutingDeps => ({
  getVwLabel: () => label,
  resolveVwIdByLabel: (l) => (l === label ? id : null),
});

const handle = (
  mode: 'inline' | 'bg' | 'modal' | 'vw',
  status: 'running' | 'backgrounded' | 'completed' | 'killed' = 'running',
) => ({ id: 'h-abc', mode, status });

describe('SRF-2 decideAttach', () => {
  test('vw + registered label + live VW → switch-vw', () => {
    const out = decideAttach(handle('vw'), depsHit('runner', 4));
    expect(out.kind).toBe('switch-vw');
    if (out.kind === 'switch-vw') {
      expect(out.windowId).toBe(4);
      expect(out.label).toBe('runner');
      expect(out.mode).toBe('vw');
    }
  });

  test('modal handle → switch-vw via the same VW path', () => {
    // modal + vw both land in the runner VW today (runner-host-factory
    // spawns a VW for both PTY modes). SRF-2 makes that explicit.
    const out = decideAttach(handle('modal'), depsHit('deploy', 7));
    expect(out.kind).toBe('switch-vw');
    if (out.kind === 'switch-vw') {
      expect(out.mode).toBe('modal');
      expect(out.windowId).toBe(7);
    }
  });

  test('inline mode → inline (no attach target)', () => {
    const out = decideAttach(handle('inline'), depsNone);
    expect(out.kind).toBe('inline');
  });

  test('bg mode while running → bg with live status', () => {
    const out = decideAttach(handle('bg', 'backgrounded'), depsNone);
    expect(out.kind).toBe('bg');
    if (out.kind === 'bg') {
      expect(out.status).toContain('backgrounded');
      expect(out.reason).toMatch(/mode:"vw"/);
    }
  });

  test('bg mode after completion → bg with settled status', () => {
    const out = decideAttach(handle('bg', 'completed'), depsNone);
    expect(out.kind).toBe('bg');
    if (out.kind === 'bg') {
      expect(out.status).toBe('completed');
    }
  });

  test('vw handle without a label → no-label outcome', () => {
    const out = decideAttach(handle('vw'), {
      getVwLabel: () => null,
      resolveVwIdByLabel: () => null,
    });
    expect(out.kind).toBe('no-label');
    if (out.kind === 'no-label') expect(out.mode).toBe('vw');
  });

  test('vw handle whose VW was closed → no-window', () => {
    // Label exists (tagVwRunner fired) but the user closed the VW.
    // SRF-1 evicts the factory cache; SRF-2 gives the user a clean
    // "re-run to respawn" message.
    const out = decideAttach(handle('vw'), {
      getVwLabel: () => 'runner',
      resolveVwIdByLabel: () => null,
    });
    expect(out.kind).toBe('no-window');
    if (out.kind === 'no-window') {
      expect(out.label).toBe('runner');
      expect(out.reason).toMatch(/closed/);
    }
  });
});
