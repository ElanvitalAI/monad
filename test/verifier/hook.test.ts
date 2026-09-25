import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  runVerifier,
  isVerifierDisabled,
  reEnableVerifier,
  listDisabledVerifiers,
  __resetVerifierTrackerForTests,
} from '../../src/verifier/hook.js';
import {
  __resetVerifierSchemaRegistryForTests,
} from '../../src/verifier/builtins/schema.js';

const ctx = { toolId: 'verifier-test-tool', surface: 'skill' as const };

beforeEach(() => {
  __resetVerifierTrackerForTests();
  __resetVerifierSchemaRegistryForTests();
});
afterEach(() => {
  __resetVerifierTrackerForTests();
  __resetVerifierSchemaRegistryForTests();
});

describe('runVerifier — happy path', () => {
  test('json-structure ok report has no issues', async () => {
    const r = await runVerifier(
      { kind: 'json-structure' },
      {},
      { output: '{"a":1}' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  test('mermaid ok report has no issues', async () => {
    const r = await runVerifier(
      { kind: 'mermaid-syntax' },
      {},
      { output: 'flowchart TD\nA --> B' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('unknown spec.kind is a no-op', async () => {
    const r = await runVerifier(
      // @ts-expect-error — exercising defensive default
      { kind: 'never-registered' },
      {},
      { output: 'whatever' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('same-issue-3 disable guard', () => {
  test('same code 3 turns in a row auto-disables verifier for that tool', async () => {
    const spec = { kind: 'json-structure' as const };
    const badResult = { output: '{a:1}' };

    expect(isVerifierDisabled(ctx.toolId)).toBe(false);

    await runVerifier(spec, {}, badResult, ctx);
    expect(isVerifierDisabled(ctx.toolId)).toBe(false);

    await runVerifier(spec, {}, badResult, ctx);
    expect(isVerifierDisabled(ctx.toolId)).toBe(false);

    await runVerifier(spec, {}, badResult, ctx);
    expect(isVerifierDisabled(ctx.toolId)).toBe(true);

    const records = listDisabledVerifiers();
    expect(records).toHaveLength(1);
    expect(records[0]?.toolId).toBe(ctx.toolId);
    expect(records[0]?.code).toBe('json.parse-error');
  });

  test('healthy run resets the streak', async () => {
    const spec = { kind: 'json-structure' as const };
    await runVerifier(spec, {}, { output: '{a:1}' }, ctx);
    await runVerifier(spec, {}, { output: '{a:1}' }, ctx);
    // Healthy turn between
    await runVerifier(spec, {}, { output: '{"a":1}' }, ctx);
    // Two more bad turns — should NOT auto-disable yet (streak reset)
    await runVerifier(spec, {}, { output: '{a:1}' }, ctx);
    await runVerifier(spec, {}, { output: '{a:1}' }, ctx);
    expect(isVerifierDisabled(ctx.toolId)).toBe(false);
  });

  test('different codes do not accumulate', async () => {
    const spec1 = { kind: 'json-structure' as const };
    const spec2 = { kind: 'mermaid-syntax' as const };
    await runVerifier(spec1, {}, { output: '{a:1}' }, ctx);
    await runVerifier(spec2, {}, { output: 'NotADiagram' }, ctx);
    await runVerifier(spec1, {}, { output: '{a:1}' }, ctx);
    expect(isVerifierDisabled(ctx.toolId)).toBe(false);
  });

  test('reEnableVerifier clears the disable record', async () => {
    const spec = { kind: 'json-structure' as const };
    const badResult = { output: '{a:1}' };
    for (let i = 0; i < 3; i++) {
      await runVerifier(spec, {}, badResult, ctx);
    }
    expect(isVerifierDisabled(ctx.toolId)).toBe(true);
    reEnableVerifier(ctx.toolId);
    expect(isVerifierDisabled(ctx.toolId)).toBe(false);
  });

  test('info-only issues never count toward the streak', async () => {
    const spec = { kind: 'schema' as const, schemaRef: 'never-registered' };
    for (let i = 0; i < 5; i++) {
      const r = await runVerifier(spec, {}, { data: {} }, ctx);
      expect(r.ok).toBe(true);   // info-only → ok stays true
    }
    expect(isVerifierDisabled(ctx.toolId)).toBe(false);
  });
});
