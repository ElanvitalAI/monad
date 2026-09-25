import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';

import { listDesignDirections } from '../design/design-directions.js';
import type { ProjectScaffoldDeps, ProjectScaffoldResult } from '../self-implement/project-scaffold.js';
import { registerRepoCommands, resolveRepositoryDesignCheck, resolveRepositoryDesignTarget, runRepositoryDesignCheck, runRepositoryDesignDirection, runRepositoryScaffold } from './repo-cli.js';
import { debug } from '../debug/log.js';
import * as standaloneLogSink from '../domains/standalone-log-sink.js';
import type { ArchiveRecord } from '../webclone/archive-run.js';
import * as extractDesignRun from '../webclone/extract-design-run.js';

const archiveRecord = (overrides: Partial<ArchiveRecord> = {}): ArchiveRecord => ({
  slug: 'archive', url: 'https://example.test', out: '/workspace/archive', dbPath: '/workspace/archive.db', capturedAt: '2026-09-09T00:00:00Z', title: null,
  originFiles: 2, mirrorOk: true, mirrorCompletion: 'completed', mirrorExitCode: 0, mirrorDepth: 1, fullPageScreenshot: { bytes: 1024, dimensions: '1280x720' }, tokens: 1,
  derived: ['DESIGN.md'], uploaded: ['s3://public/derived/DESIGN.md'], notes: [], archiveNote: '🔴 public: 공개 읽기 정책', archivedCount: 0,
  renderLocation: 'server', entryPath: '/workspace/archive/origin/index.html',
  visibleText: { mirrored: 10, rendered: 10, mirrorRendered: 10 }, mirrorCollapse: 'intact', renderedSnapshot: null, canvasCount: null,
  integrity: { checked: 2, broken: [], brokenRatio: 0 },
  ...overrides,
});

const successfulScaffold = (target: string, _deps?: ProjectScaffoldDeps): ProjectScaffoldResult => ({
  status: 'provisioned',
  target,
  resolution: { status: 'git-repo', kind: 'git-repo', target, repoRoot: target },
  ignoreFile: { added: 3, preserved: 1 },
  created: [`${target}/AGENTS.md`],
  existing: [],
});

describe('repository scaffold CLI', () => {
  test('reports paths created on the first scaffold run through injected dependencies', async () => {
    const output: string[] = [];
    const code = await runRepositoryScaffold('/workspace/new-project', {
      out: { log: (line) => output.push(line), error: (line) => output.push(`error:${line}`) },
      scaffoldProject: successfulScaffold,
    });

    expect(code).toBe(0);
    expect(output).toEqual([
      'Created: /workspace/new-project/AGENTS.md',
      'Ignore file added 3 entries and preserved 1 human-authored lines.',
    ]);
  });

  test('reports existing paths separately on a repeated scaffold run', async () => {
    const output: string[] = [];
    const code = await runRepositoryScaffold('/workspace/existing-project', {
      out: { log: (line) => output.push(line), error: (line) => output.push(`error:${line}`) },
      scaffoldProject: (target, _deps) => ({
        status: 'provisioned',
        target,
        resolution: { status: 'git-repo', kind: 'git-repo', target, repoRoot: target },
        ignoreFile: { added: 0, preserved: 4 },
        created: [],
        existing: [`${target}/AGENTS.md`],
      }),
    });

    expect(code).toBe(0);
    expect(output).toEqual([
      'Existing: /workspace/existing-project/AGENTS.md',
      'Ignore file already contained all required entries; preserved 4 human-authored lines.',
    ]);
  });

  // ⭐ 대표 2026-08-25 — *"프로젝트를 셋업하게 되면 디자인을 선택할 수 있는 «옵션이 나오도록»"*.
  //   📏 그 지시 «전»의 실측: 개설 산출 전문에 `direction`/`방향` 이 ***0건***이었다.
  //   기전(목록·`--set`·PWA 화면)은 «전부» 있었는데 방금 개설한 사람이 그것을 «모른다».
  //   ⛔ 그래서 이 저장소 자신의 DESIGN.md 가 사흘 동안 `None declared` 였다.
  test('⭐ 방향이 «안» 선언됐으면 고를 수 있음을 알린다 (대표 지시)', async () => {
    const output: string[] = [];
    const code = await runRepositoryScaffold('/workspace/fresh', {
      out: { log: (line) => output.push(line), error: (line) => output.push(`error:${line}`) },
      scaffoldProject: successfulScaffold,
      readFile: () => '# Design\n\n## Craft rulebooks\n\n- color\n',
    });

    expect(code).toBe(0);
    expect(output).toContain('Design direction: (none declared) — pick one, or leave it and decide later:');
    // ⛔ 목록을 «여기서 다시 세지» 않는다 — 정본이 늘거나 줄면 이 시험이 아니라 정본이 답한다.
    expect(output.some((line) => line.trim().startsWith('monad-pastel-default'))).toBe(true);
    expect(output.at(-1)).toBe('  → monad repo design-direction /workspace/fresh --set <direction>');
  });

  test('⭐ 방향이 «이미» 선언됐으면 목록 대신 «그 값 한 줄»만 낸다', async () => {
    const output: string[] = [];
    const code = await runRepositoryScaffold('/workspace/decided', {
      out: { log: (line) => output.push(line), error: (line) => output.push(`error:${line}`) },
      scaffoldProject: successfulScaffold,
      readFile: () => '# Design\n\n## Craft rulebooks\n\n- color\n\n## Design direction\n\n- nord-light\n',
    });

    expect(code).toBe(0);
    expect(output.at(-1)).toBe('Design direction: nord-light');
    expect(output.some((line) => line.includes('pick one'))).toBe(false);
  });

  // ⛔ 개설 «자체»는 성공했다 — 방향 안내를 못 낸다고 실패로 만들지 않는다.
  test('⭐ DESIGN.md 를 못 읽어도 개설을 «실패로 만들지 않는다»', async () => {
    const output: string[] = [];
    const code = await runRepositoryScaffold('/workspace/unreadable', {
      out: { log: (line) => output.push(line), error: (line) => output.push(`error:${line}`) },
      scaffoldProject: successfulScaffold,
      readFile: () => { throw new Error('ENOENT'); },
    });

    expect(code).toBe(0);
    expect(output.some((line) => line.includes('Design direction'))).toBe(false);
  });

  test('reports a non-applicable reason and fails rather than succeeding silently', async () => {
    const errors: string[] = [];
    const code = await runRepositoryScaffold('/workspace/missing-project', {
      out: { log: () => {}, error: (line) => errors.push(line) },
      scaffoldProject: (target) => ({ status: 'not-applicable', target, reason: 'missing', created: [], existing: [] }),
    });

    expect(code).toBe(1);
    expect(errors).toEqual(['Project scaffold blocked: missing']);
  });

  test('registers and executes scaffold beside the retained public and publish subcommands', async () => {
    const output: string[] = [];
    const exitCodes: number[] = [];
    const program = new Command();
    registerRepoCommands(program, {
      out: { log: (line) => output.push(line), error: (line) => output.push(`error:${line}`) },
      scaffoldProject: successfulScaffold,
      setExitCode: (code) => exitCodes.push(code),
    });
    const repo = program.commands.find((command) => command.name() === 'repo');

    expect(repo?.commands.map((command) => command.name())).toEqual(expect.arrayContaining(['public', 'publish', 'scaffold']));
    await program.parseAsync(['node', 'test', 'repo', 'scaffold', '/workspace/registered-project']);
    expect(output).toEqual([
      'Created: /workspace/registered-project/AGENTS.md',
      'Ignore file added 3 entries and preserved 1 human-authored lines.',
    ]);
    expect(exitCodes).toEqual([]);
  });
});

describe('repository design target resolution', () => {
  test('resolves no argument, a project directory, and a file path with a failing probe', () => {
    const cwd = '/workspace/default-project';
    const project = '/workspace/explicit-project';
    const file = '/workspace/explicit-project/custom-design.md';
    const readdir = (path: string) => {
      if (path === project) return [];
      throw new Error('ENOTDIR');
    };

    expect(resolveRepositoryDesignTarget(undefined, cwd, readdir)).toBe(resolve(cwd, 'DESIGN.md'));
    expect(resolveRepositoryDesignTarget(project, cwd, readdir)).toBe(join(project, 'DESIGN.md'));
    expect(resolveRepositoryDesignTarget(file, cwd, readdir)).toBe(resolve(file));
  });

  test('resolves relative directory and file targets from the injected cwd rather than process cwd', () => {
    const cwd = '/injected/project';
    const directory = resolve(cwd, 'nested-project');
    const file = resolve(cwd, 'custom/DESIGN.md');
    const readdir = (path: string) => {
      if (path === directory) return [];
      throw new Error('ENOTDIR');
    };

    expect(resolveRepositoryDesignTarget('nested-project', cwd, readdir)).toBe(join(directory, 'DESIGN.md'));
    expect(resolveRepositoryDesignTarget('custom/DESIGN.md', cwd, readdir)).toBe(file);
  });

  test('uses the common resolver from design-check and design-direction', async () => {
    const target = '/workspace/project';
    const documentPath = join(target, 'DESIGN.md');
    const reads: string[] = [];
    const output: string[] = [];
    const deps = {
      readdir: (path: string) => path === target ? [] : [],
      readFile: (path: string) => { reads.push(path); return '# Design\n'; },
      designCraftDirectory: () => '/workspace/craft',
      out: { log: (line: string) => output.push(line), error: () => {} },
    };

    const outcome = resolveRepositoryDesignCheck(target, deps);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.documentPath).toBe(documentPath);
    expect(await runRepositoryDesignDirection(target, undefined, deps)).toBe(0);
    expect(reads).toEqual([documentPath, documentPath]);
    expect(output).toContain(`Design document: ${documentPath}`);
  });

  test('renders the resolved document before reporting a successful direction selection', async () => {
    const documentPath = '/workspace/project/DESIGN.md';
    const chosen = listDesignDirections()[0]?.id;
    const output: string[] = [];
    const writes: Array<[string, string]> = [];

    expect(chosen).toBeDefined();
    expect(await runRepositoryDesignDirection(documentPath, chosen, {
      readdir: () => { throw new Error('ENOTDIR'); },
      readFile: () => '# Design\n',
      writeFile: (path, contents) => writes.push([path, contents]),
      out: { log: (line) => output.push(line), error: () => {} },
    })).toBe(0);

    expect(output).toEqual([
      `Design document: ${documentPath}`,
      `Design direction: ${chosen}`,
    ]);
    expect(writes).toEqual([[documentPath, expect.stringContaining(`- ${chosen}`)]]);
  });

  test('succeeds when a directory target contains DESIGN.md and preserves file-target success', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'repo-design-target-'));
    const documentPath = join(directory, 'DESIGN.md');
    const output: string[] = [];
    writeFileSync(documentPath, '# Design\n\n## Craft rulebooks\n\n', 'utf8');
    try {
      const deps = {
        readdir: (path: string) => {
          if (path === directory) return readdirSync(path);
          if (path === '/workspace/craft') return [];
          throw new Error('ENOTDIR');
        },
        readFile: (path: string, encoding: 'utf8') => readFileSync(path, encoding),
        designCraftDirectory: () => '/workspace/craft',
        out: { log: (line: string) => output.push(line), error: (line: string) => output.push(`error:${line}`) },
      };
      expect(await runRepositoryDesignCheck(directory, deps)).toBe(0);
      expect(await runRepositoryDesignCheck(documentPath, deps)).toBe(0);
      expect(output).toEqual([
        `Design document: ${documentPath}`,
        'Craft rulebooks directory: /workspace/craft',
        'Available craft rulebooks: 0 (declared: 0)',
        'Declared craft rulebooks: (none)',
        'Unavailable craft rulebooks: (none)',
        `Design document: ${documentPath}`,
        'Craft rulebooks directory: /workspace/craft',
        'Available craft rulebooks: 0 (declared: 0)',
        'Declared craft rulebooks: (none)',
        'Unavailable craft rulebooks: (none)',
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('adds target mapping only after the unchanged blocked line when a directory resolution fails', async () => {
    const errors: string[] = [];
    const target = '/workspace/project';
    const documentPath = join(target, 'DESIGN.md');
    const code = await runRepositoryDesignCheck(target, {
      readdir: (path: string) => path === target ? [] : [],
      readFile: () => { throw new Error('ENOENT'); },
      designCraftDirectory: () => '/workspace/craft',
      out: { log: () => {}, error: (line) => errors.push(line) },
    });

    expect(code).toBe(1);
    expect(errors).toEqual([
      `Repository design check blocked: cannot read ${documentPath}.`,
      `Repository design target ${target} resolved to ${documentPath}.`,
    ]);
  });

  test('omits target mapping when an explicit file path fails', async () => {
    const errors: string[] = [];
    const target = '/workspace/missing-DESIGN.md';
    const code = await runRepositoryDesignCheck(target, {
      readdir: (path: string) => {
        if (path === '/workspace/craft') return [];
        throw new Error('ENOTDIR');
      },
      readFile: () => { throw new Error('ENOENT'); },
      designCraftDirectory: () => '/workspace/craft',
      out: { log: () => {}, error: (line) => errors.push(line) },
    });

    expect(code).toBe(1);
    expect(errors).toEqual([`Repository design check blocked: cannot read ${target}.`]);
  });
});

describe('repository design-check CLI default rulebooks', () => {
  test('uses the repository craft rulebooks from external working directories and excludes non-rulebook files', async () => {
    const firstOutput: string[] = [];
    const secondOutput: string[] = [];
    const document = '# Design\n\n## Craft rulebooks\n\n- anti-ai-slop\n- accessibility-baseline\n';
    const nonRulebookDocument = '# Design\n\n## Craft rulebooks\n\n- LICENSE\n';
    const originalCwd = process.cwd();
    const externalCwds = [
      mkdtempSync(join(tmpdir(), 'repo-design-check-a-')),
      mkdtempSync(join(tmpdir(), 'repo-design-check-b-')),
    ];
    const craftDirectories: string[] = [];
    const runFrom = async (cwd: string, output: string[]) => {
      process.chdir(cwd);
      return runRepositoryDesignCheck('/external-project/DESIGN.md', {
        readdir: (directory) => {
          if (directory.endsWith('DESIGN.md')) throw new Error('ENOTDIR');
          craftDirectories.push(directory);
          return readdirSync(directory);
        },
        readFile: () => document,
        out: { log: (line) => output.push(line), error: (line) => output.push(`error:${line}`) },
      });
    };

    try {
      expect(await runFrom(externalCwds[0], firstOutput)).toBe(0);
      expect(await runFrom(externalCwds[1], secondOutput)).toBe(0);
    } finally {
      process.chdir(originalCwd);
      for (const cwd of externalCwds) rmSync(cwd, { recursive: true, force: true });
    }

    expect(craftDirectories).toHaveLength(2);
    expect(craftDirectories[0]).toBe(craftDirectories[1]);
    expect(existsSync(craftDirectories[0])).toBe(true);
    expect(readdirSync(craftDirectories[0])).toEqual(expect.arrayContaining(['anti-ai-slop.md', 'accessibility-baseline.md', 'NOTICE.md', 'LICENSE']));
    expect(firstOutput).toEqual([
      'Design document: /external-project/DESIGN.md',
      `Craft rulebooks directory: ${craftDirectories[0]}`,
      'Available craft rulebooks: 11 (declared: 2)',
      'Declared craft rulebooks: anti-ai-slop, accessibility-baseline',
      'Unavailable craft rulebooks: (none)',
    ]);
    expect(secondOutput).toEqual(firstOutput);

    const filteredOutput: string[] = [];
    expect(await runRepositoryDesignCheck('/external-project/DESIGN.md', {
      readdir: (directory) => readdirSync(directory),
      readFile: () => nonRulebookDocument,
      out: { log: (line) => filteredOutput.push(line), error: (line) => filteredOutput.push(`error:${line}`) },
    })).toBe(1);
    expect(filteredOutput).toEqual([
      'Design document: /external-project/DESIGN.md',
      `Craft rulebooks directory: ${craftDirectories[0]}`,
      'Available craft rulebooks: 11 (declared: 1)',
      'Declared craft rulebooks: LICENSE',
      'Unavailable craft rulebooks: LICENSE',
    ]);

    const noticeOutput: string[] = [];
    expect(await runRepositoryDesignCheck('/external-project/DESIGN.md', {
      readdir: (directory) => readdirSync(directory),
      readFile: () => '# Design\n\n## Craft rulebooks\n\n- NOTICE\n',
      out: { log: (line) => noticeOutput.push(line), error: (line) => noticeOutput.push(`error:${line}`) },
    })).toBe(1);
    expect(noticeOutput).toEqual([
      'Design document: /external-project/DESIGN.md',
      `Craft rulebooks directory: ${craftDirectories[0]}`,
      'Available craft rulebooks: 11 (declared: 1)',
      'Declared craft rulebooks: NOTICE',
      'Unavailable craft rulebooks: NOTICE',
    ]);
  });
});

describe('repository command help', () => {
  test('names directory-only and directory-or-DESIGN.md targets in command help', () => {
    const program = new Command();
    registerRepoCommands(program);
    const repo = program.commands.find((command) => command.name() === 'repo');
    const commands = new Map(repo?.commands.map((command) => [command.name(), command]));

    for (const name of ['public', 'scaffold', 'publish']) {
      expect(commands.get(name)?.usage()).toContain('[project-directory]');
      expect(commands.get(name)?.description()).toContain('프로젝트 디렉토리');
    }
    for (const name of ['design-check', 'design-direction']) {
      expect(commands.get(name)?.usage()).toContain('[project-directory-or-design-path]');
      expect(commands.get(name)?.description()).toContain('프로젝트 디렉토리 또는 DESIGN.md 경로');
    }
  });
});

describe('repository design CLI command wiring', () => {
  test('registered design-check and design-direction commands render their successful document evidence', async () => {
    const output: string[] = [];
    const exitCodes: number[] = [];
    const documentPath = '/workspace/project/DESIGN.md';
    const chosen = listDesignDirections()[0]?.id;
    const program = new Command();
    registerRepoCommands(program, {
      readdir: (path: string) => {
        if (path === '/workspace/craft') return ['color.md'];
        throw new Error('ENOTDIR');
      },
      readFile: () => '# Design\n\n## Craft rulebooks\n\n- color\n',
      writeFile: () => {},
      designCraftDirectory: () => '/workspace/craft',
      out: { log: (line) => output.push(line), error: (line) => output.push(`error:${line}`) },
      setExitCode: (code) => exitCodes.push(code),
    });

    expect(chosen).toBeDefined();
    await program.parseAsync(['node', 'test', 'repo', 'design-check', documentPath]);
    await program.parseAsync(['node', 'test', 'repo', 'design-direction', documentPath]);
    await program.parseAsync(['node', 'test', 'repo', 'design-direction', '--set', chosen!, documentPath]);

    expect(output.filter((line) => line === `Design document: ${documentPath}`)).toHaveLength(3);
    expect(output).toContain('Craft rulebooks directory: /workspace/craft');
    expect(output).toContain('Available craft rulebooks: 1 (declared: 1)');
    expect(output).toContain('Declared craft rulebooks: color');
    expect(output).toContain('Unavailable craft rulebooks: (none)');
    expect(exitCodes).toEqual([]);
  });
});

describe('repository design-archive CLI', () => {
  const execute = async (record: ArchiveRecord, args: string[]) => {
    const output: string[] = [];
    const errors: string[] = [];
    const exitCodes: number[] = [];
    const program = new Command();
    registerRepoCommands(program, {
      runArchive: async () => record,
      out: { log: (line) => output.push(line), error: (line) => errors.push(line) },
      setExitCode: (code) => exitCodes.push(code),
    });
    await program.parseAsync(['node', 'test', 'repo', 'design-archive', 'https://example.test', ...args]);
    return { output, errors, exitCodes };
  };

  test('fails an explicitly requested archive that was not retained while preserving its rejection and derived upload output', async () => {
    const result = await execute(archiveRecord(), ['--archive-bucket', 'public', '--upload']);

    expect(result.output).toContain('  ☁️ 공개     s3://public/derived/DESIGN.md');
    expect(result.output).toContain('  🔒 원문     🔴 public: 공개 읽기 정책');
    expect(result.errors).toEqual(['✗ 요청한 원문 보관이 이뤄지지 않았다 — --archive-bucket과 --upload를 확인하라']);
    expect(result.exitCodes).toEqual([1]);
  });

  test('preserves success when the requested archive was retained and when no archive bucket was requested', async () => {
    const retained = await execute(archiveRecord({ archiveNote: '✅ private(비공개) 로 ***2개*** 보관', archivedCount: 2 }), ['--archive-bucket', 'private', '--upload']);
    const localOnly = await execute(archiveRecord(), []);

    expect(retained.exitCodes).toEqual([]);
    expect(localOnly.exitCodes).toEqual([]);
  });

  test('preserves the existing obtained-nothing failure and its human-readable line', async () => {
    const result = await execute(archiveRecord({ originFiles: 0, tokens: null, fullPageScreenshot: { bytes: 0, dimensions: '못 쟀다' } }), ['--archive-bucket', 'public', '--upload']);

    expect(result.errors).toEqual(['✗ 아무것도 못 얻었다 — 원문 0개 · 캡처 0바이트 · 토큰 없음']);
    expect(result.exitCodes).toEqual([1]);
  });
});

describe('repository design-screen-contrast CLI', () => {
  test('registers help and emits human-readable threshold findings with exit code 1', async () => {
    const output: string[] = [];
    const exitCodes: number[] = [];
    const program = new Command();
    registerRepoCommands(program, {
      readFile: () => '\x1b[38;2;0;0;0mfaint\x1b[0m',
      out: { log: (line) => output.push(line), error: (line) => output.push(`error:${line}`) },
      setExitCode: (code) => exitCodes.push(code),
    });
    const repo = program.commands.find((command) => command.name() === 'repo');
    const command = repo?.commands.find((candidate) => candidate.name() === 'design-screen-contrast');

    expect(command?.usage()).toContain('<ansi-path>');
    expect(command?.description()).toContain('monad pty snapshot <ref> --ansi');
    expect(command?.options.map((option) => option.flags)).toEqual(expect.arrayContaining([
      '--background <hex>', '--foreground <hex>', '--threshold <n>', '--json',
    ]));
    expect(command?.options.find((option) => option.flags === '--foreground <hex>')?.description).toBe('터미널 기본 전경색 (#rrggbb)');
    await program.parseAsync(['node', 'test', 'repo', 'design-screen-contrast', '/workspace/faint.ansi', '--background', '#000000']);

    expect(output).toContain('below-threshold: "faint" 1.00:1');
    expect(output).toContain('unresolved: 0');
    expect(exitCodes).toEqual([1]);
  });

  test('forwards an explicit terminal foreground and preserves absence as unresolved', async () => {
    const withForegroundOutput: string[] = [];
    const withoutForegroundOutput: string[] = [];
    const withForegroundProgram = new Command();
    const withoutForegroundProgram = new Command();
    const depsFor = (output: string[]) => ({
      readFile: () => 'implicit-foreground',
      out: { log: (line: string) => output.push(line), error: () => {} },
      setExitCode: () => {},
    });
    registerRepoCommands(withForegroundProgram, depsFor(withForegroundOutput));
    registerRepoCommands(withoutForegroundProgram, depsFor(withoutForegroundOutput));

    await withForegroundProgram.parseAsync([
      'node', 'test', 'repo', 'design-screen-contrast', '/workspace/implicit.ansi',
      '--background', '#000000', '--foreground', '#000000',
    ]);
    await withoutForegroundProgram.parseAsync([
      'node', 'test', 'repo', 'design-screen-contrast', '/workspace/implicit.ansi', '--background', '#000000',
    ]);

    expect(withForegroundOutput).toEqual(expect.arrayContaining(['measured: 1', 'unresolved: 0']));
    expect(withoutForegroundOutput).toEqual(expect.arrayContaining(['measured: 0', 'unresolved: 1']));
  });

  test('fails when no contrast run was measured and unresolved runs remain', async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const exitCodes: number[] = [];
    const program = new Command();
    registerRepoCommands(program, {
      readFile: () => '\x1b[31munresolved\x1b[0m',
      out: { log: (line) => output.push(line), error: (line) => errors.push(line) },
      setExitCode: (code) => exitCodes.push(code),
    });

    await program.parseAsync(['node', 'test', 'repo', 'design-screen-contrast', '/workspace/unresolved.ansi']);

    expect(output).toEqual(expect.arrayContaining(['measured: 0', 'unresolved: 1']));
    expect(errors).toEqual(['✗ 대비를 잰 묶음이 없고 못 잰 묶음이 남아 있다 — 깨끗한 결과가 아니다']);
    expect(exitCodes).toEqual([1]);
  });

  test('preserves exit 0 for an empty ANSI snapshot with nothing unresolved', async () => {
    const exitCodes: number[] = [];
    const program = new Command();
    registerRepoCommands(program, {
      readFile: () => '',
      out: { log: () => {}, error: () => {} },
      setExitCode: (code) => exitCodes.push(code),
    });

    await program.parseAsync(['node', 'test', 'repo', 'design-screen-contrast', '/workspace/empty.ansi']);

    expect(exitCodes).toEqual([]);
  });

  test('emits JSON and exits 0 for a passing ANSI snapshot', async () => {
    const output: string[] = [];
    const exitCodes: number[] = [];
    const program = new Command();
    registerRepoCommands(program, {
      readFile: () => '\x1b[38;2;255;0;0mred\x1b[38;2;0;255;0mgreen\x1b[0m',
      out: { log: (line) => output.push(line), error: (line) => output.push(`error:${line}`) },
      setExitCode: (code) => exitCodes.push(code),
    });

    await program.parseAsync(['node', 'test', 'repo', 'design-screen-contrast', '/workspace/clear.ansi', '--background', '#000000', '--json']);

    expect(JSON.parse(output[0]!)).toMatchObject({ report: { findings: [], unresolved: 0 } });
    expect(exitCodes).toEqual([]);
  });

  test('reports an unreadable ANSI file as one safe line with exit code 2', async () => {
    const errors: string[] = [];
    const exitCodes: number[] = [];
    const program = new Command();
    registerRepoCommands(program, {
      readFile: () => { throw new Error('ENOENT: source details and stack trace'); },
      out: { log: () => {}, error: (line) => errors.push(line) },
      setExitCode: (code) => exitCodes.push(code),
    });

    await program.parseAsync(['node', 'test', 'repo', 'design-screen-contrast', '/workspace/missing.ansi']);

    expect(errors).toEqual(['Cannot read ANSI snapshot: /workspace/missing.ansi.']);
    expect(errors.join('\n')).not.toContain('ENOENT');
    expect(errors.join('\n')).not.toContain('stack trace');
    expect(exitCodes).toEqual([2]);
  });

  test('reports invalid threshold as an input error rather than a read failure', async () => {
    const errors: string[] = [];
    const exitCodes: number[] = [];
    const program = new Command();
    registerRepoCommands(program, {
      readFile: () => '\x1b[38;2;255;255;255mclear\x1b[0m',
      out: { log: () => {}, error: (line) => errors.push(line) },
      setExitCode: (code) => exitCodes.push(code),
    });

    await program.parseAsync(['node', 'test', 'repo', 'design-screen-contrast', '/workspace/clear.ansi', '--background', '#000000', '--threshold', '0']);

    expect(errors).toEqual(['✗ Invalid threshold: 0. Expected a positive number.']);
    expect(errors.join('\n')).not.toContain('Cannot read ANSI snapshot');
    expect(exitCodes).toEqual([1]);
  });

  test('reports invalid background as an input error rather than a read failure', async () => {
    const errors: string[] = [];
    const exitCodes: number[] = [];
    const program = new Command();
    registerRepoCommands(program, {
      readFile: () => '\x1b[38;2;255;255;255mclear\x1b[0m',
      out: { log: () => {}, error: (line) => errors.push(line) },
      setExitCode: (code) => exitCodes.push(code),
    });

    await program.parseAsync(['node', 'test', 'repo', 'design-screen-contrast', '/workspace/clear.ansi', '--background', 'not-a-hex']);

    expect(errors).toEqual(['✗ Invalid background color: not-a-hex. Expected #rrggbb.']);
    expect(errors.join('\n')).not.toContain('Cannot read ANSI snapshot');
    expect(exitCodes).toEqual([1]);
  });
});

describe('repository design command observability', () => {
  test('records divergent design-check verdicts with their returned exit codes', async () => {
    const logs: { category: string; event: string; data?: unknown }[] = [];
    const originalLog = debug.log;
    (debug as { log: typeof debug.log }).log = ((category: string, event: string, data?: unknown) => {
      logs.push({ category, event, data });
    }) as typeof debug.log;
    try {
      const cleanTarget = '/workspace/clean/DESIGN.md';
      const blockedTarget = '/workspace/blocked/DESIGN.md';
      const cleanCode = await runRepositoryDesignCheck(cleanTarget, {
        readFile: () => '# Design\n\n## Craft rulebooks\n\n- color\n',
        readdir: (path) => {
          if (path === '/workspace/craft') return ['color.md'];
          throw new Error('ENOTDIR');
        },
        designCraftDirectory: () => '/workspace/craft',
        out: { log: () => {}, error: () => {} },
      });
      const blockedCode = await runRepositoryDesignCheck(blockedTarget, {
        readFile: () => { throw new Error('ENOENT'); },
        readdir: (path) => {
          if (path === '/workspace/craft') return [];
          throw new Error('ENOTDIR');
        },
        designCraftDirectory: () => '/workspace/craft',
        out: { log: () => {}, error: () => {} },
      });
      const checkLogs = logs.filter((log) => log.category === 'repo-design-check' && log.event === 'done');

      expect(cleanCode).toBe(0);
      expect(blockedCode).toBe(1);
      expect(checkLogs).toContainEqual(expect.objectContaining({
        data: expect.objectContaining({ target: cleanTarget, exitCode: cleanCode }),
      }));
      expect(checkLogs).toContainEqual(expect.objectContaining({
        data: expect.objectContaining({ target: blockedTarget, exitCode: blockedCode }),
      }));
      const [cleanLog, blockedLog] = checkLogs;
      expect((cleanLog?.data as { verdict: unknown }).verdict).not.toBe((blockedLog?.data as { verdict: unknown }).verdict);

      const defaultCwd = '/workspace/default-project';
      const defaultDocumentPath = join(defaultCwd, 'DESIGN.md');
      expect(await runRepositoryDesignCheck(undefined, {
        cwd: () => defaultCwd,
        readFile: () => '# Design\n',
        readdir: (path) => path === '/workspace/craft' ? [] : [],
        designCraftDirectory: () => '/workspace/craft',
        out: { log: () => {}, error: () => {} },
      })).toBe(0);
      expect(logs).toContainEqual(expect.objectContaining({
        category: 'repo-design-check',
        event: 'done',
        data: expect.objectContaining({ target: defaultDocumentPath, verdict: 'clean', exitCode: 0 }),
      }));
    } finally {
      (debug as { log: typeof debug.log }).log = originalLog;
    }
  });

  test('records successful design-direction reads and writes with distinct modes', async () => {
    const logs: { category: string; event: string; data?: unknown }[] = [];
    const originalLog = debug.log;
    const target = '/workspace/project/DESIGN.md';
    const direction = listDesignDirections()[0]!.id;
    (debug as { log: typeof debug.log }).log = ((category: string, event: string, data?: unknown) => {
      logs.push({ category, event, data });
    }) as typeof debug.log;
    try {
      expect(await runRepositoryDesignDirection(target, undefined, {
        readFile: () => '# Design\n',
        readdir: () => { throw new Error('ENOTDIR'); },
        out: { log: () => {}, error: () => {} },
      })).toBe(0);
      expect(await runRepositoryDesignDirection(target, direction, {
        readFile: () => '# Design\n',
        readdir: () => { throw new Error('ENOTDIR'); },
        writeFile: () => {},
        out: { log: () => {}, error: () => {} },
      })).toBe(0);
      const directionLogs = logs.filter((log) => log.category === 'repo-design-direction' && log.event === 'done');

      expect(directionLogs).toContainEqual(expect.objectContaining({
        data: { target, direction: null, mode: 'read' },
      }));
      expect(directionLogs).toContainEqual(expect.objectContaining({
        data: { target, direction, mode: 'write' },
      }));

      const defaultCwd = '/workspace/default-direction';
      const defaultDocumentPath = join(defaultCwd, 'DESIGN.md');
      expect(await runRepositoryDesignDirection(undefined, undefined, {
        cwd: () => defaultCwd,
        readFile: () => '# Design\n',
        readdir: () => { throw new Error('ENOTDIR'); },
        out: { log: () => {}, error: () => {} },
      })).toBe(0);
      expect(logs).toContainEqual(expect.objectContaining({
        category: 'repo-design-direction',
        event: 'done',
        data: { target: defaultDocumentPath, direction: null, mode: 'read' },
      }));

      const unavailable = 'removed-direction';
      expect(await runRepositoryDesignDirection(target, undefined, {
        readFile: () => `# Design\n\n## Design direction\n\n- ${unavailable}\n`,
        readdir: () => { throw new Error('ENOTDIR'); },
        out: { log: () => {}, error: () => {} },
      })).toBe(1);
      expect(logs.filter((log) => log.category === 'repo-design-direction' && log.event === 'done')).toHaveLength(3);
    } finally {
      (debug as { log: typeof debug.log }).log = originalLog;
    }
  });
});

describe('repository design-check CLI input errors', () => {
  test('reports an unreadable craft directory with one safe error line and a nonzero code', async () => {
    const errors: string[] = [];
    const code = await runRepositoryDesignCheck('/workspace/DESIGN.md', {
      designCraftDirectory: () => '/workspace/docs/design/craft',
      readdir: () => { throw new Error('ENOENT: source details and stack trace'); },
      out: { log: () => {}, error: (line) => errors.push(line) },
    });

    expect(code).toBe(1);
    expect(errors).toEqual(['Repository design check blocked: cannot read /workspace/docs/design/craft.']);
    expect(errors.join('\n')).not.toContain('ENOENT');
    expect(errors.join('\n')).not.toContain('stack trace');
  });

  test('reports an unreadable file with one safe error line and a nonzero code', async () => {
    const errors: string[] = [];
    const code = await runRepositoryDesignCheck('/workspace/missing-DESIGN.md', {
      readFile: () => { throw new Error('ENOENT: source details and stack trace'); },
      readdir: (path: string) => {
        if (path === '/workspace/missing-DESIGN.md') throw new Error('ENOTDIR');
        return [];
      },
      out: { log: () => {}, error: (line) => errors.push(line) },
    });

    expect(code).toBe(1);
    expect(errors).toEqual(['Repository design check blocked: cannot read /workspace/missing-DESIGN.md.']);
    expect(errors.join('\n')).not.toContain('ENOENT');
    expect(errors.join('\n')).not.toContain('stack trace');
  });

  test('reports a directory through the registered command without raw filesystem details', async () => {
    const errors: string[] = [];
    const exitCodes: number[] = [];
    const program = new Command();
    registerRepoCommands(program, {
      readFile: () => { throw new Error('EISDIR: illegal operation on a directory, read'); },
      readdir: () => [],
      out: { log: () => {}, error: (line) => errors.push(line) },
      setExitCode: (code) => exitCodes.push(code),
    });

    await program.parseAsync(['node', 'test', 'repo', 'design-check', '/workspace/design-directory']);

    expect(errors).toEqual([
      'Repository design check blocked: cannot read /workspace/design-directory/DESIGN.md.',
      'Repository design target /workspace/design-directory resolved to /workspace/design-directory/DESIGN.md.',
    ]);
    expect(errors.join('\n')).not.toContain('EISDIR');
    expect(exitCodes).toEqual([1]);
  });
});

// ── `A4`/`A5` 선결 — 개설을 «잴 수 있나» (2026-08-24) ──
//
// ⛔ 이 시험은 «기능»이 아니라 ***관측***을 문다. 21차가 `A4` 의 판정 기준을
//    「스코프할 프로젝트가 실재해야 한다」로 못 박았는데, 그것을 답할 계측이 «없었다»
//    (`project-scaffold.ts` 의 debug.log = 0). ⇒ 「0행」이 「안 했다」인지
//    「계측이 없다」인지 «구별할 수 없었다».
describe('runRepositoryScaffold — 개설이 «관측에» 남는다', () => {
  test('성공하면 project-scaffold/done 이 «만든 수»와 함께 남는다', async () => {
    debug.enable(); debug.clear();
    await runRepositoryScaffold('/workspace/observed', {
      out: { log: () => {}, error: () => {} },
      scaffoldProject: successfulScaffold,
    });
    const text = debug.tail(20).join('\n');
    expect(text).toContain('[project-scaffold]');
    expect(text).toContain('done');
    expect(text).toContain('"created":1');
    expect(text).toContain('"ignoreAdded":3');
    expect(text).toContain('"ignorePreserved":1');
    debug.disable();
  });

  test('⛔ 막혀도 «남는다» — 성공만 남기면 「막혔다」가 「안 했다」와 같은 0이 된다', async () => {
    debug.enable(); debug.clear();
    await runRepositoryScaffold('/tmp/outside', {
      out: { log: () => {}, error: () => {} },
      scaffoldProject: () => ({ status: 'not-applicable', reason: 'outside-home' }) as ProjectScaffoldResult,
    });
    const text = debug.tail(20).join('\n');
    expect(text).toContain('[project-scaffold]');
    expect(text).toContain('blocked');
    expect(text).toContain('outside-home');
    debug.disable();
  });
});

describe('repository command standalone log sink registration', () => {
  const surfaces: string[] = [];
  let sinkShouldFail = false;
  let sinkSpy: ReturnType<typeof spyOn>;
  let extractSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    sinkSpy?.mockRestore();
    extractSpy?.mockRestore();
    surfaces.length = 0;
    sinkShouldFail = false;
  });

  const installSinkSpy = () => {
    sinkSpy = spyOn(standaloneLogSink, 'registerStandaloneLogSink').mockImplementation(async (surface: string) => {
      surfaces.push(surface);
      if (sinkShouldFail) throw new Error('logs.db unavailable');
      return true;
    });
  };

  const programFor = (overrides: Parameters<typeof registerRepoCommands>[1] = {}) => {
    const program = new Command();
    registerRepoCommands(program, {
      out: { log: () => {}, error: () => {} },
      setExitCode: () => {},
      ...overrides,
    });
    return program;
  };

  test('each logging repo action registers its own repo-<subcommand> sink', async () => {
    installSinkSpy();
    const documentPath = '/workspace/project/DESIGN.md';
    const designProgram = programFor({
      readdir: (path: string) => {
        if (path === '/workspace/craft') return ['color.md'];
        throw new Error('ENOTDIR');
      },
      readFile: () => '# Design\n\n## Craft rulebooks\n\n- color\n',
      writeFile: () => {},
      designCraftDirectory: () => '/workspace/craft',
    });
    await designProgram.parseAsync(['node', 'test', 'repo', 'design-check', documentPath]);
    await designProgram.parseAsync(['node', 'test', 'repo', 'design-direction', documentPath]);

    extractSpy = spyOn(extractDesignRun, 'runExtractDesign').mockImplementation(async () => ({
      slug: 'example-test',
      outDir: 'design-extract/example-test',
      viewport: { w: 1280, h: 900 },
      tokenCount: 0,
      paletteCount: 0,
      roleCount: 0,
      missingRoles: [],
      assets: [],
      assetNote: '자산 수집을 «건너뛰었다»',
      honoursReducedMotion: null,
      browserForcedReducedMotion: false,
    }));
    const extractProgram = programFor();
    await extractProgram.parseAsync(['node', 'test', 'repo', 'design-extract', 'https://example.test', '--no-assets']);

    const contrastProgram = programFor({
      readFile: () => '',
    });
    await contrastProgram.parseAsync(['node', 'test', 'repo', 'design-screen-contrast', '/workspace/empty.ansi']);

    const archiveProgram = programFor({
      runArchive: async () => archiveRecord(),
    });
    await archiveProgram.parseAsync(['node', 'test', 'repo', 'design-archive', 'https://example.test']);

    expect(surfaces).toEqual([
      'repo-design-check',
      'repo-design-direction',
      'repo-design-extract',
      'repo-design-screen-contrast',
      'repo-design-archive',
    ]);
  });

  test('sink registration failure does not block command execution', async () => {
    installSinkSpy();
    sinkShouldFail = true;
    const output: string[] = [];
    const exitCodes: number[] = [];
    const program = programFor({
      readdir: (path: string) => {
        if (path === '/workspace/craft') return ['color.md'];
        throw new Error('ENOTDIR');
      },
      readFile: () => '# Design\n\n## Craft rulebooks\n\n- color\n',
      designCraftDirectory: () => '/workspace/craft',
      out: { log: (line) => output.push(line), error: (line) => output.push(`error:${line}`) },
      setExitCode: (code) => exitCodes.push(code),
    });

    await program.parseAsync(['node', 'test', 'repo', 'design-check', '/workspace/project/DESIGN.md']);

    expect(surfaces).toEqual(['repo-design-check']);
    expect(output).toContain('Design document: /workspace/project/DESIGN.md');
    expect(exitCodes).toEqual([]);
  });

  test('existing public, scaffold, design-lint, and publish sink names stay unchanged', async () => {
    installSinkSpy();
    const program = programFor({
      isTerminal: () => false,
      scaffoldProject: successfulScaffold,
      readFile: () => { throw new Error('ENOENT: missing html'); },
    });

    await program.parseAsync(['node', 'test', 'repo', 'public', '/workspace/public-project']);
    await program.parseAsync(['node', 'test', 'repo', 'scaffold', '/workspace/registered-project']);
    await program.parseAsync(['node', 'test', 'repo', 'design-lint', '/workspace/missing.html']);
    await program.parseAsync(['node', 'test', 'repo', 'publish', '/workspace/publish-project']);

    expect(surfaces).toEqual(['repo-public', 'repo-scaffold', 'repo-design-lint', 'repo-publish']);
  });
});
