import { describe, expect, test } from 'bun:test';

import { rewriteBareNexusToStatus } from '../src/cli/nexus-entry.js';

describe('cli/nexus-entry', () => {
  test('bare nexus rewrites to status', () => {
    expect(rewriteBareNexusToStatus({ rawArgs: ['nexus'] })).toEqual(['nexus', 'status']);
  });

  test('explicit nexus invocations stay unchanged', () => {
    expect(rewriteBareNexusToStatus({ rawArgs: ['nexus', 'run'] })).toEqual(['nexus', 'run']);
    expect(rewriteBareNexusToStatus({ rawArgs: ['nexus', '--bg'] })).toEqual(['nexus', '--bg']);
  });
});
