import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIntakeCheck } from './check.js';

test('repository documentation alone cannot prove a capability', () => {
  const root = mkdtempSync(join(tmpdir(), 'intake-doc-only-'));
  const token = ['probe', 'doc', 'capability', '7'].join('-');
  try {
    for (const dir of ['catalog', 'src', 'docs']) mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, 'catalog/resources.yaml'), 'resources: []\n');
    writeFileSync(join(root, 'catalog/external-commands.yaml'), 'commands: []\n');
    writeFileSync(join(root, 'src/index.ts'), '');
    writeFileSync(join(root, 'docs/FAQ.md'), '# FAQ\n');
    writeFileSync(join(root, 'docs/PRFAQ-monad-docs-working-backwards-2026-09-22.md'), '# FAQ\n');
    writeFileSync(join(root, 'docs/notes.md'), `${token} is mentioned\n`);
    const item = runIntakeCheck([{ text: `monad 에 \`${token}\` 가 있다` }], {
      root, readFile: (path) => readFileSync(path, 'utf8'), commit: () => 'test',
      draftDir: join(root, 'drafts'), log: () => {},
    }).items[0]!;
    expect(item.verdict).toBe('판단 필요');
    expect(item.evidence.some((row) => row.repoKind === 'document' && row.path === 'docs/notes.md')).toBe(true);
    expect(item.evidence.some((row) => row.repoKind === 'behavior')).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
