import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  registerToolRuntime,
  dispatchToolByName,
  _resetToolRuntimeRegistryForTest,
} from '../../src/tool-runtime/registry.js';
import { nativeToolCatalog } from '../../src/native-tool-catalog.js';
import { __resetGuardianForTests } from '../../src/guardian/check.js';
import { setGuardianAuditSinkForTesting } from '../../src/guardian/audit-sink.js';
import type { GuardianSpec } from '../../src/guardian/types.js';

const TOOL_ID = 'guardian-dispatch-test-tool';
const origEnabled = process.env['HARNESS_GUARDIAN_ENABLED'];
const origDisabled = process.env['HARNESS_GUARDIAN_DISABLED'];

let runCalls = 0;

function injectEntry(guardian: GuardianSpec | undefined): void {
  nativeToolCatalog.push({
    id: TOOL_ID,
    aliases: [TOOL_ID],
    displayName: 'GuardianDispatchTest',
    description: 'unit',
    promptSummary: 'unit',
    surface: ['skill'],
    safety: ['mutating'],
    supportsParallel: true,
    defaultEnabled: false,
    guardian,
  });
  registerToolRuntime({
    id: TOOL_ID,
    spec: { name: TOOL_ID, description: '', input_schema: { type: 'object', properties: {}, required: [] } },
    run: async () => { runCalls += 1; return { output: 'ran' }; },
  });
}

beforeEach(() => {
  runCalls = 0;
  _resetToolRuntimeRegistryForTest();
  __resetGuardianForTests();
  setGuardianAuditSinkForTesting(() => { /* swallow in integration */ });
});
afterEach(() => {
  _resetToolRuntimeRegistryForTest();
  __resetGuardianForTests();
  setGuardianAuditSinkForTesting(null);
  const idx = nativeToolCatalog.findIndex(e => e.id === TOOL_ID);
  if (idx >= 0) nativeToolCatalog.splice(idx, 1);
  if (origEnabled === undefined) delete process.env['HARNESS_GUARDIAN_ENABLED'];
  else process.env['HARNESS_GUARDIAN_ENABLED'] = origEnabled;
  if (origDisabled === undefined) delete process.env['HARNESS_GUARDIAN_DISABLED'];
  else process.env['HARNESS_GUARDIAN_DISABLED'] = origDisabled;
});

describe('dispatchToolByName · guardian wiring', () => {
  test('catalog without guardian passes through', async () => {
    injectEntry(undefined);
    process.env['HARNESS_GUARDIAN_ENABLED'] = '1';
    const r = await dispatchToolByName(TOOL_ID, {}, { surface: 'skill' }) as Record<string, unknown>;
    expect(r['output']).toBe('ran');
    expect(runCalls).toBe(1);
  });

  test('guardian set + env off → passes through (default latency-free)', async () => {
    injectEntry({ kind: 'trust-store' });
    delete process.env['HARNESS_GUARDIAN_ENABLED'];
    const r = await dispatchToolByName(TOOL_ID, {}, { surface: 'skill' }) as Record<string, unknown>;
    expect(r['output']).toBe('ran');
    expect(runCalls).toBe(1);
  });

  test('guardian set + env on + allow verdict → runtime runs', async () => {
    injectEntry({ kind: 'trust-store' });
    process.env['HARNESS_GUARDIAN_ENABLED'] = '1';
    const r = await dispatchToolByName(TOOL_ID, {}, { surface: 'skill' }) as Record<string, unknown>;
    expect(r['output']).toBe('ran');
    expect(runCalls).toBe(1);
  });

  test('forward-compat slot short-circuits to allow (runtime still runs)', async () => {
    injectEntry({ kind: 'mutating-default' });
    process.env['HARNESS_GUARDIAN_ENABLED'] = '1';
    const r = await dispatchToolByName(TOOL_ID, {}, { surface: 'skill' }) as Record<string, unknown>;
    expect(r['output']).toBe('ran');
    expect(runCalls).toBe(1);
  });
});
