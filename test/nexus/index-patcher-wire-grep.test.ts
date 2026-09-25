// W9d-FU U5 — source-grep guards for the nexus/index.ts boot wire.
//
// Mirrors `test/notifications-outbound-nexus-wire-grep.test.ts` (#2453)
// pattern · `feedback_source_level_grep_test_value` rule. The actual
// NEXUS boot path is exercised end-to-end elsewhere (runtime-discovery
// + nexus-snapshot integration); this file just keeps the wire's
// concrete tokens frozen so a future refactor cannot silently drop the
// U5 substrate.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(HERE, '..', '..', 'src', 'nexus', 'index.ts');
const SOURCE = readFileSync(INDEX_PATH, 'utf8');

describe('nexus/index.ts · patcher-boot wire (W9d-FU U5)', () => {
  test('imports buildPatcherSubstrate + stopPatcherSubstrate + PatcherSubstrate', () => {
    expect(SOURCE).toMatch(/import\s*\{\s*buildPatcherSubstrate[\s\S]*?stopPatcherSubstrate[\s\S]*?type\s+PatcherSubstrate[\s\S]*?\}\s*from\s*'\.\.\/background-reasoning\/patcher-boot\.js'/);
  });

  test('declares function-level patcherSubstrateHandle so wrappedRelease sees it', () => {
    expect(SOURCE).toMatch(/let\s+patcherSubstrateHandle\s*:\s*PatcherSubstrate\s*\|\s*undefined/);
  });

  test('boot path assigns buildPatcherSubstrate result', () => {
    // Post W9e-FU U5: opts include the spread `entityExtractorCallable` +
    // `embeddingCallable` when user-config `background-reasoning.llm.*`
    // wires the resolver. Accept either the original `{}` form or the
    // wired form.
    expect(SOURCE).toMatch(/patcherSubstrateHandle\s*=\s*buildPatcherSubstrate\(/);
  });

  test('boot path surfaces skipReason via console.warn', () => {
    expect(SOURCE).toMatch(/console\.warn\(`\[nexus\] patcher daemon skipped/);
  });

  test('boot path surfaces success via console.info', () => {
    expect(SOURCE).toMatch(/console\.info\('\[nexus\] patcher daemon started/);
  });

  test('shutdown path invokes stopPatcherSubstrate before httpServer.stop()', () => {
    const match = SOURCE.match(/stopPatcherSubstrate\(patcherSubstrateHandle\)[\s\S]*?httpServer\?\.stop\(\)/);
    expect(match).not.toBeNull();
  });
});
