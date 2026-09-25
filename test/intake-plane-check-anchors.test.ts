import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INTAKE_PROMISE_SOURCES, runIntakeCheckDocument, type IntakeCheckDeps } from '../src/intake-plane/check.js';
import { buildIntakeDocumentStageCallables } from '../src/intake-plane/runtime-callables.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

// Command names are assembled at run time so this file never matches a repository search for them.
const cmd = ['sample', 'judge', 'k6'].join('-');
const recipe = `${cmd}-recipe`;

function fixture(reads: string[]): IntakeCheckDeps {
  const root = mkdtempSync(join(tmpdir(), 'intake-anchor-'));
  roots.push(root);
  for (const dir of ['catalog', 'src', 'docs']) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, 'catalog/resources.yaml'), 'resources: []\n');
  writeFileSync(join(root, 'catalog/external-commands.yaml'), 'commands: []\n');
  writeFileSync(join(root, 'src/index.ts'), [
    `program.command('${cmd} <question>')`,
    "  .option('--file <path>', 'read a file')",
    `program.command('${recipe} <name>')`,
    '',
  ].join('\n'));
  for (const rel of INTAKE_PROMISE_SOURCES) writeFileSync(join(root, rel), '# FAQ\n');
  return {
    root,
    readFile: (path) => { reads.push(path); return readFileSync(path, 'utf8'); },
    commit: () => 'fixture',
    draftDir: join(root, 'drafts'),
    log: () => {},
  };
}

const emptyPreprocess = JSON.stringify({ claims: [], discards: [{ quote: 'q', reason: 'r' }] });

test('document mode hands existing command names, not option flags, to preprocessing', async () => {
  const reads: string[] = [];
  let anchors: readonly string[] | undefined;
  await runIntakeCheckDocument([], { ...fixture(reads), preprocess: (args) => { anchors = args.anchors; return emptyPreprocess; } },
    { document: 'external note' });
  expect(anchors).toContain(cmd);
  expect(anchors).toContain(recipe);
  expect(anchors?.some((name) => name.startsWith('--'))).toBe(false);
});

test('document mode derives the ruler once for preprocessing, contrast and comparison', async () => {
  const reads: string[] = [];
  await runIntakeCheckDocument([], {
    ...fixture(reads),
    preprocess: () => JSON.stringify({ claims: [{ text: `monad 에 \`${cmd}\` 가 있다`, quote: 'q', lens: 'L1 능력' }], discards: [] }),
    compare: async () => JSON.stringify({ proposals: [] }),
  }, { document: 'external note' });
  expect(reads.filter((path) => path.endsWith('external-commands.yaml'))).toHaveLength(1);
});

test('production preprocess prompt lists existing names and asks for enhancement claims', async () => {
  let prompt = '';
  const stages = buildIntakeDocumentStageCallables({
    resolveRoleProvider: () => ({ provider: { name: 'fixture' } }),
    streamLLM: async (messages) => { prompt = messages[0]?.content ?? ''; return emptyPreprocess; },
  });
  await stages.preprocess({ document: '문서', lenses: ['L1 능력'], anchors: [cmd, recipe] });
  expect(prompt).toContain(`monad 에 이미 있는 명령·능력 이름: ${cmd} · ${recipe}`);
  expect(prompt).toContain('대응이 이미 있어도 버리지 않는다');
  await stages.preprocess({ document: '문서', lenses: ['L1 능력'] });
  expect(prompt).not.toContain('monad 에 이미 있는 명령·능력 이름');
});
