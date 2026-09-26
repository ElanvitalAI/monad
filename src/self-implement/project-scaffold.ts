import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { DECLARATIVE_KINDS } from '../plugin-declarative/discovery.js';
import type { GitRunResult } from '../git-fs/retry.js';
import { resolveHarnessTarget } from './harness-target-options.js';
import { provisionRepository, type RepoProvisionResult } from './repo-provision.js';

type RunGit = (cwd: string, args: string[]) => GitRunResult;

type FileSystem = Pick<typeof import('node:fs'), 'lstatSync' | 'mkdirSync' | 'realpathSync' | 'writeFileSync'>;

type DirectoryRuntime = {
  cwd(): string;
  chdir(directory: string): void;
};

export interface ProjectScaffoldDeps {
  home?: string;
  runGit?: RunGit;
  fs?: FileSystem;
  directoryRuntime?: DirectoryRuntime;
  beforeEnterDirectory?: (relativePath: string) => void;
}

export type ProjectScaffoldResult =
  | {
    status: 'provisioned' | 'already-git';
    target: string;
    resolution: Extract<RepoProvisionResult, { status: 'provisioned' | 'already-git' }>['resolution'];
    ignoreFile: Extract<RepoProvisionResult, { status: 'provisioned' | 'already-git' }>['ignoreFile'];
    created: readonly string[];
    existing: readonly string[];
  }
  | { status: 'not-applicable'; target: string; reason: string; created: readonly []; existing: readonly [] };

const PROJECT_METADATA_NAME = 'project.json';

const SCAFFOLD_FILES: readonly [readonly string[], string][] = [
  [['.elanous', PROJECT_METADATA_NAME], '{\n  "kind": "project"\n}\n'],
  [['AGENTS.md'], `# Project instructions

## Project description
<!-- Owner: describe this project in one line. Agents working in this repository read it and may guess when it is empty; the harness gate does not read it, using commands from the project manifest. -->

## Build command
<!-- Owner: add the build command. Agents working in this repository read it and may guess when it is empty; the harness gate does not read it, using commands from the project manifest. -->

## Test command
<!-- Owner: add the test command. Agents working in this repository read it and may guess when it is empty; the harness gate does not read it, using commands from the project manifest. For gate-driven tests, add a test script to the project manifest (for example, \`npm test\`). -->

## Project documents
- \`docs/goals\`: goal documents.
- \`DESIGN.md\`: design document.
- \`docs/PLAN.md\`: project plan.
- \`docs/SPEC.md\`: project specification.
`],
  // ⛔ 이 목록은 루트 `DESIGN.md` 와 «글자 그대로» 같아야 한다 — `craft-vendor.test.ts` 가
  //   `expect(rootNames).toEqual(scaffoldNames)` 로 순서까지 문다. 한쪽만 고치면 시험이 운다.
  [['DESIGN.md'], '# Design\n\n## Craft rulebooks\n\nThese rulebooks travel with elanous and are not stored in this project; run `elanous repo design-check` to locate the `Craft rulebooks directory`.\n\n- anti-ai-slop\n- accessibility-baseline\n- animation-discipline\n- color\n- form-validation\n- laws-of-ux\n- rtl-and-bidi\n- state-coverage\n- typography\n- typography-hierarchy\n- typography-hierarchy-editorial\n'],
  [['docs', 'PLAN.md'], '# Plan\n'],
  [['docs', 'SPEC.md'], '# Specification\n'],
];

const SCAFFOLD_DIRECTORIES: readonly string[][] = [
  ['.elanous'],
  ['docs'],
  ['docs', 'goals'],
  // `docs/pdca` was removed because no producer writes there and empty directories are not committed.
  // Restore it only with its producer in the same landing; keep a placeholder file with it so clones retain the directory.
];

function assertProjectMetadataIsNotDeclarative(): void {
  if (DECLARATIVE_KINDS.includes(PROJECT_METADATA_NAME as never)) {
    throw new Error(`${PROJECT_METADATA_NAME} conflicts with a declarative source directory`);
  }
}

function isWithin(path: string, root: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === '' || (!fromRoot.startsWith('..') && !fromRoot.includes(`..${sep}`));
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function assertPinnedDirectory(root: string, fs: FileSystem, runtime: DirectoryRuntime): void {
  const current = fs.realpathSync(runtime.cwd());
  const stat = fs.lstatSync(current);
  if (stat.isSymbolicLink() || !stat.isDirectory() || !isWithin(current, root)) {
    throw new Error(`scaffold directory escapes repository root: ${current}`);
  }
}

function enterDirectory(
  name: string,
  relativePath: string,
  root: string,
  fs: FileSystem,
  runtime: DirectoryRuntime,
  beforeEnterDirectory: ProjectScaffoldDeps['beforeEnterDirectory'],
): boolean {
  let created = false;
  try {
    const stats = fs.lstatSync(name);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`unsafe scaffold directory: ${join(root, relativePath)}`);
  } catch (error) {
    if (!isMissing(error)) throw error;
    try {
      fs.mkdirSync(name);
      created = true;
    } catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
    }
  }

  beforeEnterDirectory?.(relativePath);
  runtime.chdir(name);
  assertPinnedDirectory(root, fs, runtime);
  return created;
}

function returnToRoot(root: string, fs: FileSystem, runtime: DirectoryRuntime): void {
  runtime.chdir(root);
  assertPinnedDirectory(root, fs, runtime);
}

function enterParent(
  segments: readonly string[],
  root: string,
  fs: FileSystem,
  runtime: DirectoryRuntime,
  beforeEnterDirectory: ProjectScaffoldDeps['beforeEnterDirectory'],
): void {
  returnToRoot(root, fs, runtime);
  let relativePath = '';
  for (const segment of segments) {
    relativePath = relativePath ? join(relativePath, segment) : segment;
    enterDirectory(segment, relativePath, root, fs, runtime, beforeEnterDirectory);
  }
}

function scaffoldAtRoot(
  root: string,
  fs: FileSystem,
  runtime: DirectoryRuntime,
  beforeEnterDirectory: ProjectScaffoldDeps['beforeEnterDirectory'],
): Pick<ProjectScaffoldResult, 'created' | 'existing'> {
  const canonicalRoot = fs.realpathSync(root);
  const originalCwd = runtime.cwd();
  const created: string[] = [];
  const existing: string[] = [];
  try {
    runtime.chdir(canonicalRoot);
    assertPinnedDirectory(canonicalRoot, fs, runtime);

    for (const segments of SCAFFOLD_DIRECTORIES) {
      enterParent(segments.slice(0, -1), canonicalRoot, fs, runtime, beforeEnterDirectory);
      const relativePath = join(...segments);
      (enterDirectory(segments.at(-1)!, relativePath, canonicalRoot, fs, runtime, beforeEnterDirectory) ? created : existing)
        .push(join(canonicalRoot, relativePath));
    }

    for (const [segments, contents] of SCAFFOLD_FILES) {
      enterParent(segments.slice(0, -1), canonicalRoot, fs, runtime, beforeEnterDirectory);
      const filename = segments.at(-1)!;
      const absolutePath = join(canonicalRoot, ...segments);
      try {
        fs.writeFileSync(filename, contents, { encoding: 'utf8', flag: 'wx' });
        assertPinnedDirectory(canonicalRoot, fs, runtime);
        created.push(absolutePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        existing.push(absolutePath);
      }
    }
    return { created, existing };
  } finally {
    runtime.chdir(originalCwd);
  }
}

/**
 * Prepares an eligible target through the existing repository provisioner, then
 * adds only missing project-documentation paths. It is intentionally not wired
 * to a CLI; a later surface owns invoking this filesystem seam.
 */
export function scaffoldProject(target: string, deps: ProjectScaffoldDeps = {}): ProjectScaffoldResult {
  assertProjectMetadataIsNotDeclarative();
  const provisioned = provisionRepository(resolveHarnessTarget(target, { home: deps.home }), { runGit: deps.runGit });
  if (provisioned.status === 'not-applicable') return { ...provisioned, created: [], existing: [] };

  const fs = deps.fs ?? { lstatSync, mkdirSync, realpathSync, writeFileSync };
  const directoryRuntime = deps.directoryRuntime ?? { cwd: process.cwd, chdir: process.chdir };
  return { ...provisioned, ...scaffoldAtRoot(provisioned.target, fs, directoryRuntime, deps.beforeEnterDirectory) };
}
