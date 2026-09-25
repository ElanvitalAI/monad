import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inlineCodeIdentifiers, sourceIdentifierInventory } from './source-identifiers.js';

test('TypeScript AST 인벤토리와 단일 inline-code 식별자 추출은 문서 린터와 공유한다', () => {
  const root = mkdtempSync(join(tmpdir(), 'source-identifiers-'));
  try {
    mkdirSync(join(root, 'nested'));
    writeFileSync(join(root, 'nested', 'sample.ts'), 'export const liveIdentifier = 1;\n');
    writeFileSync(join(root, 'ignored.js'), 'const javascriptOnly = 1;\n');
    expect(sourceIdentifierInventory(root)).toEqual(expect.any(Set));
    expect(sourceIdentifierInventory(root).has('liveIdentifier')).toBe(true);
    expect(sourceIdentifierInventory(root).has('javascriptOnly')).toBe(false);
    expect(inlineCodeIdentifiers('`liveIdentifier` `` `two words` `also_live`')).toEqual(new Set(['liveIdentifier', 'also_live']));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
