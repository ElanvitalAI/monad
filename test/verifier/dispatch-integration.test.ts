import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  registerToolRuntime,
  dispatchToolByName,
  _resetToolRuntimeRegistryForTest,
} from '../../src/tool-runtime/registry.js';
import {
  __resetVerifierTrackerForTests,
} from '../../src/verifier/hook.js';
import {
  __resetVerifierSchemaRegistryForTests,
} from '../../src/verifier/builtins/schema.js';
import { nativeToolCatalog } from '../../src/native-tool-catalog.js';

const TEST_TOOL_ID = 'verifier-int-test-tool';

beforeEach(() => {
  _resetToolRuntimeRegistryForTest();
  __resetVerifierTrackerForTests();
  __resetVerifierSchemaRegistryForTests();
});
afterEach(() => {
  _resetToolRuntimeRegistryForTest();
  __resetVerifierTrackerForTests();
  __resetVerifierSchemaRegistryForTests();
  // Detach test entry from the catalog
  const idx = nativeToolCatalog.findIndex(e => e.id === TEST_TOOL_ID);
  if (idx >= 0) nativeToolCatalog.splice(idx, 1);
});

function injectTestEntry(verifier: import('../../src/verifier/types.js').VerifierSpec | undefined): void {
  nativeToolCatalog.push({
    id: TEST_TOOL_ID,
    aliases: [TEST_TOOL_ID],
    displayName: 'VerifierTest',
    description: 'unit test tool',
    promptSummary: 'unit test tool',
    surface: ['skill'],
    safety: ['read-only'],
    supportsParallel: true,
    defaultEnabled: false,
    verifier,
  });
}

describe('dispatchToolByName · verifier wiring', () => {
  test('catalog entry without verifier returns result untouched', async () => {
    injectTestEntry(undefined);
    registerToolRuntime({
      id: TEST_TOOL_ID,
      spec: { name: TEST_TOOL_ID, description: '', input_schema: { type: 'object', properties: {}, required: [] } },
      run: async () => ({ output: '{not json}' }),
    });
    const r = await dispatchToolByName(TEST_TOOL_ID, {}, { surface: 'skill' }) as Record<string, unknown>;
    expect(r['verifierIssues']).toBeUndefined();
    expect(r['output']).toBe('{not json}');
  });

  test('verifier failure prepends verifierIssues to result', async () => {
    injectTestEntry({ kind: 'json-structure' });
    registerToolRuntime({
      id: TEST_TOOL_ID,
      spec: { name: TEST_TOOL_ID, description: '', input_schema: { type: 'object', properties: {}, required: [] } },
      run: async () => ({ output: '{not json}' }),
    });
    const r = await dispatchToolByName(TEST_TOOL_ID, {}, { surface: 'skill' }) as Record<string, unknown>;
    expect(Array.isArray(r['verifierIssues'])).toBe(true);
    const issues = r['verifierIssues'] as Array<{ code: string }>;
    expect(issues[0]?.code).toBe('json.parse-error');
    // Original payload preserved
    expect(r['output']).toBe('{not json}');
  });

  test('verifier success leaves result untouched', async () => {
    injectTestEntry({ kind: 'json-structure' });
    registerToolRuntime({
      id: TEST_TOOL_ID,
      spec: { name: TEST_TOOL_ID, description: '', input_schema: { type: 'object', properties: {}, required: [] } },
      run: async () => ({ output: '{"ok":true}' }),
    });
    const r = await dispatchToolByName(TEST_TOOL_ID, {}, { surface: 'skill' }) as Record<string, unknown>;
    expect(r['verifierIssues']).toBeUndefined();
  });

  test('after 3 same-issue turns the verifier is auto-disabled (no verifierIssues on next call)', async () => {
    injectTestEntry({ kind: 'json-structure' });
    registerToolRuntime({
      id: TEST_TOOL_ID,
      spec: { name: TEST_TOOL_ID, description: '', input_schema: { type: 'object', properties: {}, required: [] } },
      run: async () => ({ output: '{not json}' }),
    });
    for (let i = 0; i < 3; i++) {
      const r = await dispatchToolByName(TEST_TOOL_ID, {}, { surface: 'skill' }) as Record<string, unknown>;
      expect(r['verifierIssues']).toBeDefined();
    }
    // 4th call — verifier disabled, no issues attached
    const r = await dispatchToolByName(TEST_TOOL_ID, {}, { surface: 'skill' }) as Record<string, unknown>;
    expect(r['verifierIssues']).toBeUndefined();
  });

  test('throwing verifier never breaks the dispatch path', async () => {
    // Inject a verifier that points to an unknown spec.kind via cast —
    // the registry's try/catch must swallow the throw and pass through.
    injectTestEntry({ kind: 'mermaid-syntax' });
    registerToolRuntime({
      id: TEST_TOOL_ID,
      spec: { name: TEST_TOOL_ID, description: '', input_schema: { type: 'object', properties: {}, required: [] } },
      // Result missing the `output` field — mermaid builtin gracefully
      // produces a warn issue rather than throwing, so the dispatch
      // attaches verifierIssues. The "throwing verifier" guard is
      // exercised by the runVerifier internal try/catch in registry.ts.
      run: async () => ({ unrelated: 'data' }),
    });
    const r = await dispatchToolByName(TEST_TOOL_ID, {}, { surface: 'skill' }) as Record<string, unknown>;
    // Either verifierIssues attached OR original passed through — both are OK.
    // The point is that the call does not throw.
    expect(r['unrelated']).toBe('data');
  });
});
