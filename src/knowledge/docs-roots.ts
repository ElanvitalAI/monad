// 기억(self_recall) 문서 수집 뿌리 — 고정 경로가 아니라 설정 또는 자동 감지.
// 해석 규칙은 이 파일 한 곳에만 있다.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type KnowledgeDocsRootSource = 'config' | 'tool-checkout' | 'workdir' | 'none';

interface KnowledgeDocsRoot {
  path: string;
  source: Exclude<KnowledgeDocsRootSource, 'none'>;
}

interface KnowledgeDocsRootsResult {
  roots: KnowledgeDocsRoot[];
  source: KnowledgeDocsRootSource;
}

interface ResolveKnowledgeDocsRootsOpts {
  /**
   * 설정 `knowledge.docsRoots`.
   * 배열이 주어지면(빈 배열 포함) 그 값만 쓰고 자동 감지를 섞지 않는다.
   * 생략(`undefined`)일 때만 자동 감지한다.
   */
  docsRoots?: readonly string[];
  /**
   * 도구 체크아웃 판정 기준 모듈.
   * 기본은 이 파일. `scripts/knowledge-ingest.ts` 는 자기 `import.meta.url` 을 넘긴다
   * (`import.meta.dir/../docs` = 패키지 뿌리의 docs).
   */
  toolModuleUrl?: string;
  /** `toolModuleUrl` 에서 docs 까지의 상대 세그먼트. 기본 `['..','docs']`. */
  toolDocsSegments?: readonly string[];
  /** 현재 작업 디렉터리. 기본은 process.cwd(). */
  cwd?: string;
  exists?: (path: string) => boolean;
  readPackageName?: (packageJsonPath: string) => string | undefined;
  gitRoot?: (cwd: string) => string | undefined;
}

const TOOL_PACKAGE_NAME = 'elanous';

function defaultReadPackageName(packageJsonPath: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: unknown };
    return typeof raw.name === 'string' ? raw.name : undefined;
  } catch {
    return undefined;
  }
}

/** 실제 git 작업 트리 뿌리. `.git` 파일/디렉터리 존재만으로는 저장소로 보지 않는다. */
function defaultGitRoot(cwd: string): string | undefined {
  const probe = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: resolve(cwd),
    encoding: 'utf8',
    timeout: 5000,
  });
  if (probe.status !== 0) return undefined;
  const top = probe.stdout.trim();
  return top.length > 0 ? top : undefined;
}

function dedupe(roots: KnowledgeDocsRoot[]): KnowledgeDocsRoot[] {
  const seen = new Set<string>();
  const out: KnowledgeDocsRoot[] = [];
  for (const root of roots) {
    const key = resolve(root.path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: key, source: root.source });
  }
  return out;
}

/** 수집 뿌리 목록과 각 뿌리의 출처. 없으면 빈 목록 ⊕ source `none`. */
export function resolveKnowledgeDocsRoots(opts: ResolveKnowledgeDocsRootsOpts = {}): KnowledgeDocsRootsResult {
  // 배열이 있으면(빈 배열·공백만) 설정이 있는 것이다. 자동 감지로 넘어가지 않는다.
  if (opts.docsRoots !== undefined) {
    const configured = opts.docsRoots
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p) => p.length > 0);
    if (configured.length === 0) return { roots: [], source: 'none' };
    const roots = dedupe(configured.map((path) => ({ path, source: 'config' as const })));
    return { roots, source: 'config' };
  }

  const exists = opts.exists ?? existsSync;
  const readPackageName = opts.readPackageName ?? defaultReadPackageName;
  const gitRootOf = opts.gitRoot ?? defaultGitRoot;
  const moduleDir = dirname(fileURLToPath(opts.toolModuleUrl ?? import.meta.url));
  const candidates: KnowledgeDocsRoot[] = [];
  const toolDocsSegments = opts.toolDocsSegments ?? ['..', 'docs'];

  const toolDocs = resolve(moduleDir, ...toolDocsSegments);
  const toolPackage = join(dirname(toolDocs), 'package.json');
  if (exists(toolDocs) && readPackageName(toolPackage) === TOOL_PACKAGE_NAME) {
    candidates.push({ path: toolDocs, source: 'tool-checkout' });
  }

  const gitRoot = gitRootOf(opts.cwd ?? process.cwd());
  if (gitRoot) {
    const workDocs = join(gitRoot, 'docs');
    if (exists(workDocs)) candidates.push({ path: workDocs, source: 'workdir' });
  }

  const roots = dedupe(candidates);
  if (roots.length === 0) return { roots: [], source: 'none' };
  return { roots, source: roots.length === 1 ? roots[0]!.source : roots[0]!.source };
}
