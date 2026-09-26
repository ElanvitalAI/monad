import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { schemaBuiltin } from '../../src/verifier/builtins/schema.js';
import { mermaidSyntaxBuiltin } from '../../src/verifier/builtins/mermaid-syntax.js';
import { jsonStructureBuiltin } from '../../src/verifier/builtins/json-structure.js';
import { fileExistsBuiltin } from '../../src/verifier/builtins/file-exists.js';
import {
  registerVerifierSchema,
  __resetVerifierSchemaRegistryForTests,
} from '../../src/verifier/builtins/schema.js';
import type { VerifierContext } from '../../src/verifier/types.js';

const ctx: VerifierContext = { toolId: 'test-tool', surface: 'skill' };

beforeEach(() => {
  __resetVerifierSchemaRegistryForTests();
});

describe('schema builtin', () => {
  test('ok when registered schema validates', async () => {
    registerVerifierSchema('greeting', {
      kind: 'object',
      shape: { name: { kind: 'string' } },
      required: ['name'],
    });
    const r = await schemaBuiltin(
      {},
      { data: { name: 'elanous' } },
      { kind: 'schema', schemaRef: 'greeting' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  test('reports warn on schema mismatch', async () => {
    registerVerifierSchema('greeting', {
      kind: 'object',
      shape: { name: { kind: 'string' } },
      required: ['name'],
    });
    const r = await schemaBuiltin(
      {},
      { data: { name: 42 } },
      { kind: 'schema', schemaRef: 'greeting' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.severity).toBe('warn');
    expect(r.issues[0]?.code).toMatch(/^schema\./);
  });

  test('missing schemaRef returns info issue but ok=true', async () => {
    const r = await schemaBuiltin(
      {},
      { data: {} },
      { kind: 'schema', schemaRef: 'missing' },
      ctx,
    );
    expect(r.issues[0]?.severity).toBe('info');
    expect(r.issues[0]?.code).toBe('schema.missing-ref');
    // info-only → ok stays true (PLAN §5.3 footnote 4)
    expect(r.ok).toBe(true);
  });

  test('honours custom field selector', async () => {
    registerVerifierSchema('s', { kind: 'string' });
    const r = await schemaBuiltin(
      {},
      { custom: 'hello' },
      { kind: 'schema', schemaRef: 's', field: 'custom' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('mermaid-syntax builtin', () => {
  test('ok for plain flowchart', async () => {
    const r = await mermaidSyntaxBuiltin(
      {},
      { output: 'flowchart TD\nA --> B' },
      { kind: 'mermaid-syntax' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  test('ok for fenced mermaid block', async () => {
    const r = await mermaidSyntaxBuiltin(
      {},
      { output: '```mermaid\nsequenceDiagram\nA->>B: hi\n```' },
      { kind: 'mermaid-syntax' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('warns on unrecognised first-keyword', async () => {
    const r = await mermaidSyntaxBuiltin(
      {},
      { output: 'NotADiagram blah\nA --> B' },
      { kind: 'mermaid-syntax' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'mermaid.unknown-kind')).toBe(true);
  });

  test('warns on unbalanced brackets', async () => {
    const r = await mermaidSyntaxBuiltin(
      {},
      { output: 'flowchart TD\nA[unclosed --> B' },
      { kind: 'mermaid-syntax' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'mermaid.unbalanced-bracket')).toBe(true);
  });

  test('warns on empty source', async () => {
    const r = await mermaidSyntaxBuiltin(
      {},
      { output: '' },
      { kind: 'mermaid-syntax' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'mermaid.empty')).toBe(true);
  });

  test('honours custom field selector', async () => {
    const r = await mermaidSyntaxBuiltin(
      {},
      { diagram: 'pie\n"Slice" : 1' },
      { kind: 'mermaid-syntax', field: 'diagram' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('json-structure builtin', () => {
  test('ok for valid JSON', async () => {
    const r = await jsonStructureBuiltin(
      {},
      { output: '{"a":1}' },
      { kind: 'json-structure' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('warns on parse error', async () => {
    const r = await jsonStructureBuiltin(
      {},
      { output: '{a:1}' },
      { kind: 'json-structure' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.code).toBe('json.parse-error');
  });

  test('warns when not a string', async () => {
    const r = await jsonStructureBuiltin(
      {},
      { output: 42 },
      { kind: 'json-structure' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.code).toBe('json.not-string');
  });

  test('schemaRef triggers structure validation', async () => {
    registerVerifierSchema('arr', { kind: 'array', of: { kind: 'number' } });
    const r = await jsonStructureBuiltin(
      {},
      { output: '[1, "two", 3]' },
      { kind: 'json-structure', schemaRef: 'arr' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code.startsWith('json.schema.'))).toBe(true);
  });

  test('schemaRef with valid match returns ok', async () => {
    registerVerifierSchema('arr', { kind: 'array', of: { kind: 'number' } });
    const r = await jsonStructureBuiltin(
      {},
      { output: '[1, 2, 3]' },
      { kind: 'json-structure', schemaRef: 'arr' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('file-exists builtin', () => {
  let dir: string;
  let alpha: string;
  let beta: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'verifier-fe-'));
    alpha = join(dir, 'alpha.txt');
    beta = join(dir, 'beta.txt');
    writeFileSync(alpha, 'a');
    writeFileSync(beta, 'b');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('ok when string path exists', async () => {
    const r = await fileExistsBuiltin(
      {},
      { writtenPath: alpha },
      { kind: 'file-exists', field: 'writtenPath' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('ok when string[] paths exist', async () => {
    const r = await fileExistsBuiltin(
      {},
      { paths: [alpha, beta] },
      { kind: 'file-exists', field: 'paths' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('warns on missing path', async () => {
    const r = await fileExistsBuiltin(
      {},
      { paths: [alpha, join(dir, 'nope.txt')] },
      { kind: 'file-exists', field: 'paths' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'file-exists.missing')).toBe(true);
  });

  test('warns when field shape is invalid', async () => {
    const r = await fileExistsBuiltin(
      {},
      { paths: 42 },
      { kind: 'file-exists', field: 'paths' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.code).toBe('file-exists.field-shape');
  });

  test('empty array is benign', async () => {
    const r = await fileExistsBuiltin(
      {},
      { paths: [] },
      { kind: 'file-exists', field: 'paths' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});
