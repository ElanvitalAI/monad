import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { NativeToolCatalogEntry } from '../native-tool-catalog.js';
import type { SignalSnapshot } from './signals.js';
import { evaluateGate, resetGateCache } from './gate.js';

const TARGET_TOOL_ID = 'run_dev_harness';

const signals: SignalSnapshot = {
  hasPython: false,
  hasNodeProject: false,
  hasGitRemote: false,
  intentResearch: false,
  intentDiagram: false,
  recentNetworkError: false,
  intentBrowse: false,
  intentViz: false,
  intentCapture: false,
  intentOpsFleet: false,
  intentOpsUi: false,
  intentCoding: false,
  paidKeyGrok: false,
  paidCliFirecrawl: false,
  hasActivePtyModal: false,
  backgroundedPtyCount: 0,
  hasSessionAttention: false,
  fingerprint: 'gate-default-enabled-test',
};

function catalogWithDefaultEnabled(defaultEnabled: boolean): NativeToolCatalogEntry[] {
  return [{
    id: TARGET_TOOL_ID,
    kind: 'other',
    aliases: [],
    displayName: 'Run dev harness',
    description: 'Runs the development harness.',
    promptSummary: 'Run the development harness.',
    host: ['all'],
    safety: ['process'],
    supportsParallel: false,
    defaultEnabled,
  }];
}

describe('evaluateGate defaultEnabled stage', () => {
  beforeEach(resetGateCache);
  afterEach(resetGateCache);

  test('excludes a default-disabled catalog entry', () => {
    const catalog = catalogWithDefaultEnabled(false);

    const decision = evaluateGate(catalog, [], signals);

    expect(decision.filtered).not.toContain(TARGET_TOOL_ID);
  });

  test('includes the same catalog entry when only defaultEnabled is true', () => {
    const catalog = catalogWithDefaultEnabled(true);

    const decision = evaluateGate(catalog, [], signals);

    expect(decision.filtered).toContain(TARGET_TOOL_ID);
  });
});
