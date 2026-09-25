import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';

import { registerRepoCommands, runRepositoryDesignCheck } from '../cli/repo-cli.js';
import { scaffoldProject } from '../self-implement/project-scaffold.js';
import { parseDesignDocument } from './design-doc.js';

/** 합성 픽스처 — 파서의 「선언 ↔ 가용」 대조 자체를 무는 데만 쓴다. 실제 목록이 아니다. */
const rulebooks = ['anti-ai-slop', 'accessibility-baseline'];

const CRAFT_DIRECTORY = join(import.meta.dir, '..', '..', 'docs', 'design', 'craft');

/**
 * ⛔ 실제 스캐폴드 문서를 무는 시험은 규칙서 목록을 «손으로 적지 않는다».
 * 규칙집을 하나 더 들일 때마다 기대값을 고쳐야 했고, 그 손목록이 이미 «네 번째 사본»이었다.
 * ⇒ 정본(디렉토리)에서 도출한다. `craft-vendor.test.ts` 의 `deriveCraftRulebookNames` 와 같은 규칙이다.
 */
function availableCraftRulebooks(): string[] {
  return readdirSync(CRAFT_DIRECTORY)
    .filter((name) => name.endsWith('.md') && name !== 'NOTICE.md')
    .map((name) => name.slice(0, -'.md'.length));
}

const directories: string[] = [];

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'design-doc-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('parseDesignDocument', () => {
  test('returns declared available rulebooks', () => {
    expect(parseDesignDocument('# Design\n\n## Craft rulebooks\n\n- anti-ai-slop\n', rulebooks)).toEqual({
      declaredRulebooks: ['anti-ai-slop'],
      unavailableRulebooks: [],
    });
  });

  test('preserves craft rulebook declaration encounter order', () => {
    expect(parseDesignDocument('## Craft rulebooks\n\n- third-rulebook\n- first-rulebook\n- second-rulebook\n', [
      'first-rulebook',
      'second-rulebook',
      'third-rulebook',
    ])).toEqual({
      declaredRulebooks: ['third-rulebook', 'first-rulebook', 'second-rulebook'],
      unavailableRulebooks: [],
    });
  });

  test('returns no declarations for a document without the section', () => {
    expect(parseDesignDocument('# Design\n', rulebooks)).toEqual({ declaredRulebooks: [], unavailableRulebooks: [] });
  });

  test('reports unavailable declarations without throwing', () => {
    expect(parseDesignDocument('## Craft rulebooks\n\n- unknown-rulebook\n', rulebooks)).toEqual({
      declaredRulebooks: ['unknown-rulebook'],
      unavailableRulebooks: ['unknown-rulebook'],
    });
  });

  test('derives unavailable declarations from the supplied reduced list', () => {
    expect(parseDesignDocument('## Craft rulebooks\n\n- accessibility-baseline\n', ['anti-ai-slop'])).toEqual({
      declaredRulebooks: ['accessibility-baseline'],
      unavailableRulebooks: ['accessibility-baseline'],
    });
  });

  test('accepts the exact scaffolded DESIGN.md declarations', () => {
    const directory = createDirectory();
    const result = scaffoldProject(directory, { home: tmpdir(), runGit: () => ({ status: 0, stdout: '', stderr: '' }) });
    const document = readFileSync(join(result.target, 'DESIGN.md'), 'utf8');
    const available = availableCraftRulebooks();

    // ⭐ 분모를 먼저 못 박는다 — 디렉토리가 비면 「전부 통과」가 아니라 «측정 안 함»이다.
    expect(available.length).toBeGreaterThan(0);

    const parsed = parseDesignDocument(document, available);
    // ⛔ 순서로 비교하지 않는다 — 선언 순서는 저작 판단이고 `readdirSync` 순서는 파일시스템 것이다.
    //   이 시험이 무는 계약은 «둘이 같은 집합인가» ⊕ «못 찾은 것이 없는가» 다.
    expect([...parsed.declaredRulebooks].sort()).toEqual([...available].sort());
    expect(parsed.unavailableRulebooks).toEqual([]);
  });
});

describe('repo design check', () => {
  test('reports unavailable declarations and returns a nonzero exit code through injected dependencies', async () => {
    const output: string[] = [];
    const code = await runRepositoryDesignCheck('/workspace/DESIGN.md', {
      readFile: () => '## Craft rulebooks\n\n- missing-rulebook\n',
      readdir: () => ['anti-ai-slop.md', 'NOTICE.md', 'LICENSE', 'accessibility-baseline.md'],
      out: { log: (line) => output.push(line), error: (line) => output.push(`error:${line}`) },
    });

    expect(code).toBe(1);
    // ⛔ 위치로 묻지 않는다 — `#12211` 이 성공 산출에 `Design document:` ·
    //   `Craft rulebooks directory:` · `Available craft rulebooks:` 세 줄을 «앞에» 더했고,
    //   그때 이 파일이 `toEqual([두 줄])` 이라 깨졌다(변경파일 스코프 게이트가 이 파일을 안 돌렸다).
    //   ⇒ 접두로 «그 줄»을 찾아 문면만 확인한다. 줄이 더 붙어도 이 단언은 살아남는다.
    expect(output).toContain('Declared craft rulebooks: missing-rulebook');
    expect(output).toContain('Unavailable craft rulebooks: missing-rulebook');
  });

  test('registers a design-check command that accepts the scaffolded document', async () => {
    const directory = createDirectory();
    const result = scaffoldProject(directory, { home: tmpdir(), runGit: () => ({ status: 0, stdout: '', stderr: '' }) });
    const output: string[] = [];
    const exitCodes: number[] = [];
    const program = new Command();
    registerRepoCommands(program, {
      out: { log: (line) => output.push(line), error: (line) => output.push(`error:${line}`) },
      setExitCode: (code) => exitCodes.push(code),
      designCraftDirectory: () => join(process.cwd(), 'docs', 'design', 'craft'),
    });

    await program.parseAsync(['node', 'test', 'repo', 'design-check', join(result.target, 'DESIGN.md')]);
    // ⛔ 규칙서 이름을 손으로 적지 않는다(§ availableCraftRulebooks 의 주석).
    //   ⭐ 그러면서도 ***「무엇을 냈나」를 여전히 문다*** — 선언 줄이 정본 집합과 같고, 못 찾은 것이 없다.
    const available = availableCraftRulebooks();
    expect(available.length).toBeGreaterThan(0);
    // ⛔ 위치 대신 «접두»로 찾는다 — 위 단언과 같은 이유(`#12211` 회귀).
    const declaredLine = output.find((line) => line.startsWith('Declared craft rulebooks: '));
    expect(declaredLine).toBeDefined();
    expect(declaredLine!.replace('Declared craft rulebooks: ', '').split(', ').sort()).toEqual([...available].sort());
    expect(output).toContain('Unavailable craft rulebooks: (none)');
    expect(exitCodes).toEqual([]);
  });
});
