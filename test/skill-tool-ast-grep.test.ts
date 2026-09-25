import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAstGrepHostTool,
  buildAstGrepTool,
  dispatchAstGrep,
  hasAstGrep,
} from '../src/skills/tools/ast-grep.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'ast-grep-tool-'));
}

describe('buildAstGrepTool', () => {
  test('exposes structural search schema', () => {
    const tool = buildAstGrepTool();
    expect(tool.name).toBe('AstGrep');
    const schema = tool.parameters as any;
    expect(schema.properties.pattern.type).toBe('string');
    expect(schema.properties.rule.type).toBe('string');
    expect(schema.properties.lang.type).toBe('string');
    expect(schema.properties.output_mode.enum).toEqual(['summary', 'files_with_matches', 'json']);
  });

  test('host tool uses snake_case name', async () => {
    const tool = buildAstGrepHostTool();
    expect(tool.name).toBe('ast_grep_search');
    expect(typeof tool.handler).toBe('function');
  });
});

describe('dispatchAstGrep', () => {
  test('pattern mode finds TypeScript calls', async () => {
    if (!hasAstGrep()) return;
    const dir = tmp();
    try {
      writeFileSync(join(dir, 'a.ts'), 'const x = 1;\nconsole.log(x);\n');
      const result = await dispatchAstGrep({
        pattern: 'console.log($ARG)',
        lang: 'typescript',
        path: dir,
      });
      expect(result.numMatches).toBe(1);
      expect(result.output).toContain('a.ts');
      expect(result.output).toContain('console.log');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('inline rule mode supports relational search', async () => {
    if (!hasAstGrep()) return;
    const dir = tmp();
    try {
      writeFileSync(join(dir, 'a.ts'), 'async function run() {\n  await fetch("/x");\n}\nfunction skip() {}\n');
      const result = await dispatchAstGrep({
        rule: [
          'id: async-with-await',
          'language: typescript',
          'rule:',
          '  kind: function_declaration',
          '  has:',
          '    pattern: await $EXPR',
          '    stopBy: end',
        ].join('\n'),
        path: dir,
        output_mode: 'files_with_matches',
      });
      expect(result.numFiles).toBe(1);
      expect(result.output).toContain('a.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('validates mutually exclusive inputs', async () => {
    await expect(dispatchAstGrep({ pattern: 'x', rule: 'id: x' }))
      .rejects.toThrow('mutually exclusive');
    await expect(dispatchAstGrep({ pattern: 'x' }))
      .rejects.toThrow('lang is required');
  });
});
