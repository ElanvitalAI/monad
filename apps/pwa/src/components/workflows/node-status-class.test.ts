// Ergonomic-port Tier E2.2 (2026-05-11) — class-name mapping tests.

import { describe, expect, it } from 'bun:test';
import { nodeStatusClass } from './node-status-class';

describe('nodeStatusClass', () => {
  it('returns the baseline class when no status is supplied', () => {
    expect(nodeStatusClass(undefined)).toBe('workflow-node-status');
  });

  it('emits the running variant', () => {
    expect(nodeStatusClass('running')).toBe(
      'workflow-node-status workflow-node-status-running',
    );
  });

  it('emits the done variant', () => {
    expect(nodeStatusClass('done')).toBe(
      'workflow-node-status workflow-node-status-done',
    );
  });

  it('emits the failed variant', () => {
    expect(nodeStatusClass('failed')).toBe(
      'workflow-node-status workflow-node-status-failed',
    );
  });

  it('emits the skipped variant', () => {
    expect(nodeStatusClass('skipped')).toBe(
      'workflow-node-status workflow-node-status-skipped',
    );
  });
});
