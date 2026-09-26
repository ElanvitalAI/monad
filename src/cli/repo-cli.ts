import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import * as readline from 'node:readline/promises';
import type { Command } from 'commander';

import { debug } from '../debug/log.js';
import { designCheckExitCode, resolveDesignCheck, type DesignCheckOutcome } from '../design/design-check.js';
import { listDesignDirections, parseDeclaredDirection, writeDeclaredDirection } from '../design/design-directions.js';
import { runScreenContrast } from '../design/screen-contrast-run.js';
import { archiveObtainedNothing, formatArchiveRecord, runArchive, type ArchiveRecord } from '../webclone/archive-run.js';
import { resolveHarnessTarget } from '../self-implement/harness-target-options.js';
import { scaffoldProject, type ProjectScaffoldDeps, type ProjectScaffoldResult } from '../self-implement/project-scaffold.js';
import { makeRepositoryPublic, preflightRepositoryPublish, preflightRepositoryVisibility, provisionRepository, publishRepository, repositoryRemoteVisibility, repositoryRemoteVisibilityForTarget, resolveRepositoryRoot, type RepositoryPublishDeps, type RepositoryPublishPreflight } from '../self-implement/repo-provision.js';

export interface RepoCliDeps extends RepositoryPublishDeps, ProjectScaffoldDeps {
  cwd?: () => string;
  isTerminal?: () => boolean;
  confirm?: (prompt: string) => Promise<string | undefined>;
  out?: { log: (message: string) => void; error: (message: string) => void };
  scaffoldProject?: (target: string, deps?: ProjectScaffoldDeps) => ProjectScaffoldResult;
  readFile?: (path: string, encoding: 'utf8') => string;
  writeFile?: (path: string, contents: string) => void;
  readdir?: (path: string) => readonly string[];
  designCraftDirectory?: () => string;
  runArchive?: (options: Parameters<typeof runArchive>[0]) => Promise<ArchiveRecord>;
  setExitCode?: (code: number) => void;
}

async function confirmPublication(prompt: string): Promise<string | undefined> {
  if (!stdin.isTTY) return undefined;
  const input = readline.createInterface({ input: stdin, output: stdout, terminal: true });
  try { return await input.question(prompt); } catch { return undefined; } finally { input.close(); }
}

const liveDeps: Required<Pick<RepoCliDeps, 'cwd' | 'isTerminal' | 'confirm' | 'out' | 'scaffoldProject' | 'readFile' | 'writeFile' | 'readdir' | 'designCraftDirectory' | 'runArchive' | 'setExitCode'>> = {
  cwd: () => process.cwd(),
  isTerminal: () => Boolean(stdin.isTTY),
  confirm: confirmPublication,
  out: console,
  scaffoldProject,
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, contents) => writeFileSync(path, contents, 'utf8'),
  readdir: (path) => readdirSync(path),
  designCraftDirectory: () => resolve(import.meta.dir, '..', '..', 'docs', 'design', 'craft'),
  runArchive,
  setExitCode: (code) => { process.exitCode = code; },
};

function renderReport(report: RepositoryPublishPreflight, visibility?: 'private' | 'public'): string[] {
  return [
    `Repository: ${report.repository}${visibility ? ` (${visibility})` : ''}`,
    `Ignored: ${report.ignored.join(', ') || '(none)'}`,
    `Committed: ${report.committed.join(', ') || '(none)'}`,
    `Credential candidates: ${report.credentialCandidates.join(', ') || '(none)'}`,
  ];
}

export async function runRepositoryPublic(target: string | undefined, overrides: RepoCliDeps = {}): Promise<number> {
  const deps = { ...liveDeps, ...overrides };
  const requestedCwd = resolve(target ?? deps.cwd());
  if (!deps.isTerminal()) {
    deps.out.log('Repository public transition requires an interactive terminal; GitHub visibility was not read or changed.');
    debug.log('repo-provision', 'visibility-noninteractive', { target: requestedCwd });
    return 0;
  }
  const cwd = resolveRepositoryRoot(requestedCwd, deps);
  if (!cwd) {
    deps.out.error(`Repository public transition blocked: ${requestedCwd} is not inside a Git work tree.`);
    debug.log('repo-provision', 'visibility-command-blocked', { target: requestedCwd, blockers: ['target is not inside a Git work tree'] }, { level: 'error' });
    return 1;
  }
  const initialVisibility = repositoryRemoteVisibilityForTarget(cwd, deps);
  if (initialVisibility.status === 'blocked') {
    deps.out.error(initialVisibility.guidance);
    debug.log('repo-provision', 'visibility-command-blocked', { target: cwd, blockers: ['GitHub repository visibility response was invalid'] }, { level: 'error' });
    return 1;
  }
  if (initialVisibility.status === 'public') {
    deps.out.log(`GitHub repository ${initialVisibility.repository} is already public; no visibility change was made.`);
    debug.log('repo-provision', 'already-public', { target: cwd, repository: initialVisibility.repository, at: new Date().toISOString() });
    return 0;
  }
  const report = preflightRepositoryVisibility(cwd, deps);
  const remoteVisibility = repositoryRemoteVisibility(report, deps);
  if (remoteVisibility.status === 'blocked') {
    for (const line of renderReport(report)) deps.out.log(line);
    deps.out.error(remoteVisibility.guidance);
    debug.log('repo-provision', 'visibility-command-blocked', { target: cwd, repository: report.repository, remote: report.remote, blockers: ['GitHub repository visibility response was invalid'] }, { level: 'error' });
    return 1;
  }
  for (const line of renderReport(report, remoteVisibility.status)) deps.out.log(line);
  if (remoteVisibility.status === 'public') {
    deps.out.log(`GitHub repository ${report.remote} is already public; no visibility change was made.`);
    debug.log('repo-provision', 'already-public', { target: cwd, repository: report.repository, remote: report.remote, at: new Date().toISOString() });
    return 0;
  }
  if (report.blockers.length) {
    deps.out.error(`Repository public transition blocked: ${report.blockers.join('; ')}`);
    deps.out.error(report.credentialCandidates.length
      ? 'Resolve: remove the listed credential files from every reachable ref and the working tree, commit the removal, then run repo public again.'
      : 'Resolve the listed blockers, then run repo public again.');
    debug.log('repo-provision', 'visibility-command-blocked', { target: cwd, blockers: report.blockers }, { level: 'error' });
    return 1;
  }
  const answer = await deps.confirm(`Make GitHub repository ${report.remote} public? This cannot undo copied, cached, or indexed data. [y/N] `);
  if (answer?.trim().toLowerCase() !== 'y') {
    deps.out.log('Repository public transition declined; GitHub visibility was not changed.');
    debug.log('repo-provision', 'visibility-declined', { target: cwd, repository: report.repository, remote: report.remote });
    return 0;
  }
  const result = makeRepositoryPublic(cwd, deps, report);
  if (result.status === 'promoted') {
    deps.out.log(`Made GitHub repository ${result.repository} public.`);
    return 0;
  }
  if (result.status === 'already-public') {
    deps.out.log(`GitHub repository ${result.repository} is already public; no visibility change was made.`);
    return 0;
  }
  deps.out.error(result.guidance);
  return 1;
}

export async function runRepositoryScaffold(target: string | undefined, overrides: RepoCliDeps = {}): Promise<number> {
  const deps = { ...liveDeps, ...overrides };
  const targetPath = resolve(target ?? deps.cwd());
  const result = deps.scaffoldProject(targetPath, deps);

  // ⭐ `A4`/`A5` 선결 (2026-08-24 · `[F]` 22차) — ***개설을 «잴 수 있게» 한다.***
  //
  //   21차 로드맵이 `A4`(프로젝트별 MCP 스코프)의 판정 기준을 「스코프할 «프로젝트»가
  //   실재해야 한다」로 못 박았다. 그런데 그것을 답할 «관측»이 없었다 —
  //   `project-scaffold.ts` 에 `debug.log` 가 ***0개***고 이 CLI 도 아무것도 안 남겼다.
  //   ⇒ 「개설된 적이 있나」를 물으면 ***디스크를 뒤지는 수밖에 없었다***(22차가 그렇게 쟀다).
  //
  //   ⛔ 「0행」이 「안 했다」인지 「계측이 없다」인지 구별할 수 없는 상태였고, 그것은
  //   이 저장소가 반복해서 데인 바로 그 형태다(MANUAL-time-and-windows ⑪).
  //
  //   ⛔ 실패도 «같이» 남긴다 — 성공만 남기면 「막혔다」가 「안 했다」와 같은 0이 된다.
  debug.log('project-scaffold', result.status === 'not-applicable' ? 'blocked' : 'done', {
    target: targetPath,
    ...(result.status === 'not-applicable'
      ? { reason: result.reason }
      : {
        created: result.created.length,
        existing: result.existing.length,
        ignoreAdded: result.ignoreFile.added,
        ignorePreserved: result.ignoreFile.preserved,
      }),
  }, result.status === 'not-applicable' ? { level: 'warn' } : {});

  if (result.status === 'not-applicable') {
    deps.out.error(`Project scaffold blocked: ${result.reason}`);
    return 1;
  }
  for (const path of result.created) deps.out.log(`Created: ${path}`);
  for (const path of result.existing) deps.out.log(`Existing: ${path}`);
  deps.out.log(result.ignoreFile.added === 0
    ? `Ignore file already contained all required entries; preserved ${result.ignoreFile.preserved} human-authored lines.`
    : `Ignore file added ${result.ignoreFile.added} entries and preserved ${result.ignoreFile.preserved} human-authored lines.`);
  for (const line of scaffoldDesignDirectionLines(targetPath, deps)) deps.out.log(line);
  return 0;
}

/** 개설 «직후» 「디자인 방향을 고를 수 있다」를 말한다 (대표 2026-08-25).
 *
 *  🎯 지시 원문: *"react, nextjs 등의 프로젝트를 셋업하게 되면 디자인을 선택할 수
 *  있는 «옵션이 나오도록»"*. ⛔ 기본값을 «박는» 것이 아니다 — 고를 수 있음을 «알리는»
 *  것이다. 방향은 취향이라 기계가 정하면 안 된다.
 *
 *  📏 왜 필요했나(2026-08-25 실측): 개설 산출 전문에 `direction`/`방향` 이 ***0건***이었다.
 *  기전은 «전부» 있었다 — `listDesignDirections`(여섯) · `--set` · PWA `/app/design-check`.
 *  그런데 방금 개설한 사람은 ***그것이 있는지조차 모른다***. 그래서 실제로
 *  이 저장소 자신의 `DESIGN.md` 가 사흘 동안 `None declared` 였다.
 *
 *  ⛔ 재구현하지 않는다 — 방향 목록·선언 파싱은 `design-directions.ts` 가 정본이다.
 *  여기서 다시 세면 그 순간 「같은 질문에 자가 둘」이 된다(오늘 이 저장소가 세 번 데인 형태). */
function scaffoldDesignDirectionLines(targetPath: string, deps: typeof liveDeps): string[] {
  const documentPath = join(targetPath, 'DESIGN.md');
  let document: string;
  try {
    document = deps.readFile(documentPath, 'utf8');
  } catch {
    // ⛔ 개설 자체는 성공했다 — 방향 안내를 못 낸다고 실패로 만들지 않는다.
    return [];
  }

  const available = listDesignDirections();
  const { declared } = parseDeclaredDirection(document, available);
  if (declared !== null) return [`Design direction: ${declared}`];

  return [
    'Design direction: (none declared) — pick one, or leave it and decide later:',
    ...available.map((d) => `  ${d.id}  ${d.mood}`),
    `  → elanous repo design-direction ${targetPath} --set <direction>`,
  ];
}

/** Resolves a repository design target to the document that commands read.
 *  A successful readdir probe means the explicit target is a project directory;
 *  probe failures preserve file-path compatibility without blocking the command. */
export function resolveRepositoryDesignTarget(
  target: string | undefined,
  cwd: string,
  readdir: (path: string) => readonly string[],
): string {
  if (target === undefined) return resolve(cwd, 'DESIGN.md');
  const targetPath = resolve(cwd, target);
  try {
    readdir(targetPath);
    return join(targetPath, 'DESIGN.md');
  } catch {
    return targetPath;
  }
}

/** Resolves the design-check verdict for the CLI's target without printing
 *  anything. Exposed so non-terminal surfaces (daemon route, TUI pane) reuse
 *  the SAME resolution — including how the target path and craft directory are
 *  chosen — instead of re-deriving it and drifting. */
export function resolveRepositoryDesignCheck(
  target: string | undefined,
  overrides: RepoCliDeps = {},
): DesignCheckOutcome {
  const deps = { ...liveDeps, ...overrides };
  return resolveDesignCheck(
    resolveRepositoryDesignTarget(target, deps.cwd(), deps.readdir),
    deps.designCraftDirectory(),
    { readFile: deps.readFile, readdir: deps.readdir },
  );
}

function designTargetResolutionMessage(target: string | undefined, cwd: string, documentPath: string): string | undefined {
  if (target === undefined) return undefined;
  const targetPath = resolve(cwd, target);
  return targetPath === documentPath ? undefined : `Repository design target ${targetPath} resolved to ${documentPath}.`;
}

export async function runRepositoryDesignCheck(target: string | undefined, overrides: RepoCliDeps = {}): Promise<number> {
  const deps = { ...liveDeps, ...overrides };
  const outcome = resolveRepositoryDesignCheck(target, overrides);
  // ⛔ Message text is a contract, not cosmetics — `#11793` settled on this
  //    "blocked: cannot read <path>" wording so a caller outside the elanous
  //    tree learns WHICH path failed. Keep it byte-identical.
  if (!outcome.ok) {
    deps.out.error(`Repository design check blocked: cannot read ${outcome.path}.`);
    const resolution = outcome.blockedOn === 'design-document'
      ? designTargetResolutionMessage(target, deps.cwd(), outcome.path)
      : undefined;
    if (resolution) deps.out.error(resolution);
  } else {
    deps.out.log(`Design document: ${outcome.documentPath}`);
    deps.out.log(`Craft rulebooks directory: ${outcome.craftDirectory}`);
    deps.out.log(`Available craft rulebooks: ${outcome.availableRulebooks.length} (declared: ${outcome.declaredRulebooks.length})`);
    deps.out.log(`Declared craft rulebooks: ${outcome.declaredRulebooks.join(', ') || '(none)'}`);
    deps.out.log(`Unavailable craft rulebooks: ${outcome.unavailableRulebooks.join(', ') || '(none)'}`);
  }
  const exitCode = designCheckExitCode(outcome);
  const verdict = !outcome.ok
    ? `blocked:${outcome.blockedOn}`
    : outcome.unavailableRulebooks.length ? 'unavailable-rulebooks' : 'clean';
  const resolvedTarget = outcome.ok ? outcome.documentPath : outcome.path;
  debug.log('repo-design-check', 'done', { target: resolvedTarget, verdict, exitCode });
  return exitCode;
}

/** B5 — 대화 시작에 내밀 「방향」을 보여주거나 고른다.
 *
 *  ⛔ 방향 «목록»을 여기서 만들지 않는다 — `listDesignDirections` 가 `THEME_REGISTRY`
 *  에서 도출하고, 이 함수는 그것을 렌더하거나 `DESIGN.md` 에 적기만 한다.
 *  ⭐ 대상 문서·규칙집 뿌리 결정은 `resolveRepositoryDesignCheck` 과 «같은 규칙»을
 *  써야 하므로 경로 계산을 복제하지 않고 그 자리(`join(cwd, 'DESIGN.md')`)를 따른다. */
export async function runRepositoryDesignDirection(
  target: string | undefined,
  chosen: string | undefined,
  overrides: RepoCliDeps = {},
): Promise<number> {
  const deps = { ...liveDeps, ...overrides };
  const documentPath = resolveRepositoryDesignTarget(target, deps.cwd(), deps.readdir);
  const directions = listDesignDirections();

  let document: string;
  try {
    document = deps.readFile(documentPath, 'utf8');
  } catch {
    // `design-check` 과 «같은 문형» — `#11793` 이 정한 계약이다.
    deps.out.error(`Repository design direction blocked: cannot read ${documentPath}.`);
    const resolution = designTargetResolutionMessage(target, deps.cwd(), documentPath);
    if (resolution) deps.out.error(resolution);
    return 1;
  }

  if (chosen !== undefined) {
    // ⛔ 모르는 이름을 «조용히» 쓰지 않는다. 쓰고 나면 그 문서는
    //    「선언했는데 못 찾겠다」 상태가 되고, 그것을 만든 것이 우리가 된다.
    if (!directions.some((d) => d.id === chosen)) {
      deps.out.error(`Repository design direction blocked: unknown direction ${chosen}.`);
      deps.out.error(`Available directions: ${directions.map((d) => d.id).join(', ') || '(none)'}`);
      return 1;
    }
    try {
      deps.writeFile(documentPath, writeDeclaredDirection(document, chosen));
    } catch (err) {
      deps.out.error(`Repository design direction blocked: cannot write ${documentPath}.`);
      debug.log('repo-design-direction', 'write-failed', { documentPath, error: String(err) }, { level: 'error' });
      return 1;
    }
    deps.out.log(`Design document: ${documentPath}`);
    deps.out.log(`Design direction: ${chosen}`);
    debug.log('repo-design-direction', 'done', { target: documentPath, direction: chosen, mode: 'write' });
    return 0;
  }

  const declaration = parseDeclaredDirection(document, directions);
  deps.out.log(`Design document: ${documentPath}`);
  deps.out.log(`Design direction: ${declaration.declared ?? '(none declared)'}`);
  if (declaration.unavailable) {
    deps.out.error(`Unavailable design direction: ${declaration.unavailable}`);
  }
  for (const d of directions) {
    const mark = d.id === declaration.declared ? '*' : ' ';
    deps.out.log(`${mark} ${d.id}  ${d.mood}`);
  }
  // 선언이 «있는데 못 찾는» 경우만 실패다. 선언이 없는 것은 정상 상태다 —
  // 방향을 아직 안 고른 프로젝트가 깨진 프로젝트는 아니다.
  const exitCode = declaration.unavailable ? 1 : 0;
  if (exitCode === 0) {
    debug.log('repo-design-direction', 'done', { target: documentPath, direction: declaration.declared, mode: 'read' });
  }
  return exitCode;
}

export async function runRepositoryPublish(target: string | undefined, overrides: RepoCliDeps = {}): Promise<number> {
  const deps = { ...liveDeps, ...overrides };
  const cwd = resolve(target ?? deps.cwd());
  const local = provisionRepository(resolveHarnessTarget(cwd, { home: dirname(cwd) }), deps);
  if (local.status === 'not-applicable') {
    deps.out.error(`Repository publication blocked: ${local.reason}`);
    return 1;
  }
  const report = preflightRepositoryPublish(local.target, deps);
  for (const line of renderReport(report)) deps.out.log(line);
  if (report.blockers.length) {
    deps.out.error(`Repository publication blocked: ${report.blockers.join('; ')}`);
    deps.out.error(report.credentialCandidates.length
      ? 'Resolve: remove the listed credential files from every reachable ref, commit the removal, then retry.'
      : 'Resolve the listed blockers, then retry.');
    debug.log('repo-provision', 'publish-command-blocked', { target: cwd, blockers: report.blockers }, { level: 'error' });
    return 1;
  }
  const answer = await deps.confirm(`Create private GitHub repository ${report.repository} and push ${report.branch}? [y/N] `);
  if (answer?.trim().toLowerCase() !== 'y') {
    deps.out.log('Repository publication declined; no remote was created and local repository changes remain.');
    debug.log('repo-provision', 'publish-declined', { target: cwd, repository: report.repository, branch: report.branch });
    return 0;
  }
  const result = publishRepository(local.target, deps, report);
  if (result.status === 'created') {
    deps.out.log(`Created private GitHub repository ${result.report.repository} and pushed ${result.report.branch}.`);
    return 0;
  }
  deps.out.error(result.guidance);
  return 1;
}

export function registerRepoCommands(program: Command, overrides: RepoCliDeps = {}): void {
  const deps = { ...liveDeps, ...overrides };
  const repo = program.command('repo').description('명시적 로컬 저장소 GitHub 비공개 발행');
  repo.command('public [project-directory]')
    .description('프로젝트 디렉토리의 기존 private GitHub 저장소를 전체 이력 점검과 명시적 확인 뒤 public으로 전환')
    .action(async (target: string | undefined) => {
      try {
        const { registerStandaloneLogSink } = await import('../domains/standalone-log-sink.js');
        await registerStandaloneLogSink('repo-public');
      } catch { /* visibility transition remains available if observation bootstrap fails */ }
      const code = await runRepositoryPublic(target, deps);
      if (code !== 0) deps.setExitCode(code);
    });
  repo.command('scaffold [project-directory]')
    .description('프로젝트 디렉토리 저장소를 준비하고 빠진 골격 문서를 만든다')
    .action(async (target: string | undefined) => {
      // ⛔ 싱크가 «없으면» 계측이 어디에도 안 닿는다 — `repo publish` 는 이미 이것을
      //   등록하는데 `scaffold` 는 «안 했다». 그래서 22차가 개설 계측을 더한 «직후»
      //   라이브로 쳤더니 파일은 만들어졌는데 `project-scaffold` 가 ***0행***이었다.
      //   ⇒ 「관측을 더했다」와 「관측이 «닿는다»」는 다른 값이다(이 창이 세 번째로 밟았다).
      try {
        const { registerStandaloneLogSink } = await import('../domains/standalone-log-sink.js');
        await registerStandaloneLogSink('repo-scaffold');
      } catch { /* 개설은 관측 부트스트랩이 실패해도 계속된다 */ }
      const code = await runRepositoryScaffold(target, deps);
      if (code !== 0) deps.setExitCode(code);
    });
  repo.command('design-check [project-directory-or-design-path]')
    .description('프로젝트 디렉토리 또는 DESIGN.md 경로의 craft rulebook 선언이 현재 규칙집과 일치하는지 검사')
    .action(async (target: string | undefined) => {
      try {
        const { registerStandaloneLogSink } = await import('../domains/standalone-log-sink.js');
        await registerStandaloneLogSink('repo-design-check');
      } catch { /* fail-open — 관측 배선이 명령을 막지 않는다 */ }
      const code = await runRepositoryDesignCheck(target, deps);
      if (code !== 0) deps.setExitCode(code);
    });
  repo.command('design-direction [project-directory-or-design-path]')
    .description('프로젝트 디렉토리 또는 DESIGN.md 경로에서 B5 시각 방향을 보여주거나(인자 없이) --set 으로 선언한다')
    .option('--set <direction>', '이 방향을 DESIGN.md 에 선언한다')
    .action(async (target: string | undefined, opts: { set?: string }) => {
      try {
        const { registerStandaloneLogSink } = await import('../domains/standalone-log-sink.js');
        await registerStandaloneLogSink('repo-design-direction');
      } catch { /* fail-open — 관측 배선이 명령을 막지 않는다 */ }
      const code = await runRepositoryDesignDirection(target, opts.set, deps);
      if (code !== 0) deps.setExitCode(code);
    });
  repo.command('design-extract <url>')
    .description('라이브 웹 페이지에서 «에셋 + DESIGN.md» 를 뽑는다 — 팔레트·서체·모션·대비 쌍을 elanous 가 읽는 형식으로')
    .option('--out <dir>', '출력 뿌리 (기본: ./design-extract)')
    .option('--no-assets', '자산 미러를 건너뛴다 — 규칙만 뽑는다')
    .option('--port <n>', 'CDP 포트 (기본 9355)')
    .option('--viewports <list>', '⭐ 여러 폭에서 «다시» 재 반응형 분기를 본다 (예: 390,768,1280)')
    .option('--attach-timeout <ms>', 'CDP 가 뜨기를 기다릴 예산 (기본 5000 · ⛔ 부하가 높으면 올려라)')
    .action(async (url: string, opts: {
      out?: string; assets?: boolean; port?: string; viewports?: string; attachTimeout?: string;
    }) => {
      try {
        const { registerStandaloneLogSink } = await import('../domains/standalone-log-sink.js');
        await registerStandaloneLogSink('repo-design-extract');
      } catch { /* fail-open — 관측 배선이 명령을 막지 않는다 */ }
      // ⛔ 여기서 로직을 다시 짜지 않는다 — `extract-design-run.ts` 가 정본이고
      //    `scripts/webclone/extract-design.ts` 도 같은 것을 부른다.
      try {
        const { formatExtractDesignResult, runExtractDesign } = await import('../webclone/extract-design-run.js');
        const result = await runExtractDesign({
          url, outRoot: opts.out ?? 'design-extract',
          withAssets: opts.assets !== false,
          port: opts.port === undefined ? undefined : Number(opts.port),
          // ⛔ 못 읽는 값은 «버린다» — NaN 을 예산으로 넘기면 while 조건이 조용히 거짓이 된다
          attachTimeoutMs: (() => {
            const parsed = Number(opts.attachTimeout);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
          })(),
          // ⛔ 못 읽는 값은 «버린다» — 0 이나 NaN 을 폭으로 넘기면 브라우저가 조용히 이상해진다
          viewports: opts.viewports
            ?.split(',')
            .map((w) => Number(w.trim()))
            .filter((w) => Number.isInteger(w) && w >= 240 && w <= 3840),
        });
        deps.out.log(`  원본        ${url}`);
        for (const line of formatExtractDesignResult(result)) deps.out.log(line);
      } catch (error) {
        deps.out.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
        deps.setExitCode(1);
      }
    });
  // ⭐⭐ 웹클론 판정을 ***하니스 라인 안에서*** 부를 수 있게 하는 문 (2026-09-13 🅕 · 대표 지시).
  //   🩸 왜: 판정 도구가 `scripts/webclone/` 에만 있어서 ***사람이 밖에서 치는 것***이었다.
  //      자식 워크트리는 그 경로를 모르고, 런은 판정 결과를 «모른 채» 닫혔다(9/9 인 산출이 abandoned).
  //   ⇒ ⓐ 어느 cwd 에서나 부를 수 있고 ⓑ 판정이 `elanous logs --category webclone.judge` 로 흐르고
  //      ⓒ `--require` 면 종료 코드로 «성패»를 말한다.
  //   ⛔ 로직을 여기서 다시 짜지 않는다 — `scripts/webclone/{check-clone,check-layout}.ts` 가 정본이다.
  repo.command('webclone-judge <clone-dir>')
    .description('웹클론 산출을 «두 축»으로 판정한다 — 파일 축 ⊕ 배치 축(CDP). 관측은 webclone.judge')
    .requiredOption('--spec <dir>', '명세 디렉토리(파이프라인이 낸 spec/)')
    .option('--page <path>', '배치 축을 한 쪽만 잰다 (기본: 명세의 전 쪽)')
    .option('--skip-layout', '배치 축을 건너뛴다 — ⛔ 「안 쟀음」은 통과가 아니다')
    .option('--require', '두 축이 다 통과해야 종료 코드 0')
    .action(async (cloneDir: string, opts: { spec: string; page?: string; skipLayout?: boolean; require?: boolean }) => {
      try {
        const { registerStandaloneLogSink } = await import('../domains/standalone-log-sink.js');
        await registerStandaloneLogSink('repo-webclone-judge');
      } catch { /* fail-open — 관측 배선이 판정을 막지 않는다 */ }
      const { fileURLToPath } = await import('node:url');
      const { join, dirname } = await import('node:path');
      const here = dirname(fileURLToPath(import.meta.url));
      const scripts = join(here, '..', '..', 'scripts', 'webclone');
      const run = async (script: string, args: string[]): Promise<{ code: number; out: string }> => {
        // ⭐ stderr 는 «흘려 보낸다» — 채점기가 쪽마다 진행을 거기 적는다.
        //   🩸 2026-09-14 7판 terra: 전 쪽 채점이 5분 넘게 «말없이» 돌자 감독자가 「진행 없음」으로 판정해 재작업을 걸었다.
        //   ⛔ 게다가 'pipe' 로 받고 «안 읽으면» 버퍼가 차는 순간 자식이 멈춘다.
        const proc = Bun.spawn(['bun', join(scripts, script), ...args], { stdout: 'pipe', stderr: 'inherit' });
        const out = await new Response(proc.stdout).text();
        await proc.exited;
        return { code: proc.exitCode ?? 1, out };
      };
      const file = await run('check-clone.ts', ['--clone', cloneDir, '--spec', opts.spec, '--json']);
      let fileReport: Record<string, unknown> | null = null;
      try { fileReport = JSON.parse(file.out) as Record<string, unknown>; } catch { fileReport = null; }
      const filePass = Boolean((fileReport as { allPass?: boolean } | null)?.allPass);

      let layoutPass = false;
      let layoutWhy = '';
      let measureBrowser: { base?: string; browser?: string; dedicated?: boolean } | undefined;
      let unmeasuredCells = 0;
      if (opts.skipLayout) layoutWhy = '--skip-layout 을 줬다';
      else {
        const layout = await run('check-layout.ts',
          ['--clone', cloneDir, '--spec', opts.spec, ...(opts.page ? ['--page', opts.page] : []), '--json']);
        try {
          const report = JSON.parse(layout.out) as {
            allPass?: boolean;
            measureBrowser?: { base?: string; browser?: string; dedicated?: boolean };
            unmeasuredCells?: number;
          };
          layoutPass = Boolean(report.allPass);
          measureBrowser = report.measureBrowser;
          unmeasuredCells = typeof report.unmeasuredCells === 'number' ? report.unmeasuredCells : 0;
        } catch { layoutWhy = 'check-layout 이 JSON 을 안 냈다(CDP 미가동 의심)'; }
      }
      const gates = (fileReport as { gates?: Array<{ id: string; pass: boolean; got: string }> } | null)?.gates ?? [];
      deps.out.log(`\n🧾 웹클론 판정 — ${cloneDir}`);
      deps.out.log(`【파일 축】 ${gates.filter((g) => g.pass).length}/${gates.length}`);
      for (const g of gates) deps.out.log(`  ${g.pass ? '✅' : '⛔'} ${g.id} — ${g.got}`);
      const browserLabel = measureBrowser
        ? `${measureBrowser.browser ?? '미상'} @ ${measureBrowser.base ?? '미상'}${measureBrowser.dedicated ? ' · 전용 9333' : ' · 비전용'}`
        : '브라우저 정보 없음';
      const remeasure = unmeasuredCells > 0 ? ' ⚠️ 못 잰 칸은 산출 결함이 아니라 다시 재야 한다.' : '';
      deps.out.log(layoutWhy
        ? `【배치 축】 ⛔ ***안 쟀다*** — ${layoutWhy}  ⚠️ 「안 쟀음」은 통과가 아니다`
        : `【배치 축】 ${layoutPass ? '✅ 통과' : '⛔ 실패'} · ${browserLabel} · 못 잰 칸 ${unmeasuredCells}${remeasure}   (자세히: bun scripts/webclone/check-layout.ts --clone ${cloneDir} --spec ${opts.spec})`);
      const all = filePass && layoutPass;
      deps.out.log(all ? '✅ ***두 축 모두 통과***' : `⛔ 실패 — 파일 축 ${filePass ? '통과' : '실패'} · 배치 축 ${layoutWhy ? '«안 쟀다»' : (layoutPass ? '통과' : '실패')}`);
      const { debug } = await import('../debug/log.js');
      debug.log('webclone.judge', 'both-axes', {
        clone: cloneDir, spec: opts.spec, filePass, layoutPass, layoutSkipped: Boolean(layoutWhy), allPass: all,
      }, { level: all ? 'info' : 'warn' });
      if (opts.require && !all) deps.setExitCode(1);
    });

  repo.command('design-screen-contrast <ansi-path>')
    .description('ANSI 화면 스냅샷의 텍스트 대비를 검사 — `elanous pty snapshot <ref> --ansi` 산출을 파일로 준다')
    .option('--background <hex>', '터미널 기본 배경색 (#rrggbb)')
    .option('--foreground <hex>', '터미널 기본 전경색 (#rrggbb)')
    .option('--threshold <n>', '최소 대비 문턱 (기본: 4.5)')
    .option('--json', '기계용 JSON')
    .action(async (ansiPath: string, opts: { background?: string; foreground?: string; threshold?: string; json?: boolean }) => {
      try {
        const { registerStandaloneLogSink } = await import('../domains/standalone-log-sink.js');
        await registerStandaloneLogSink('repo-design-screen-contrast');
      } catch { /* fail-open — 관측 배선이 명령을 막지 않는다 */ }
      let ansi: string;
      try {
        ansi = deps.readFile(ansiPath, 'utf8');
      } catch {
        deps.out.error(`Cannot read ANSI snapshot: ${ansiPath}.`);
        deps.setExitCode(2);
        return;
      }

      try {
        const threshold = opts.threshold === undefined ? undefined : Number(opts.threshold);
        if (threshold !== undefined && (!Number.isFinite(threshold) || threshold <= 0)) {
          throw new Error(`Invalid threshold: ${opts.threshold}. Expected a positive number.`);
        }
        const result = runScreenContrast({ ansi, background: opts.background, foreground: opts.foreground, threshold });
        if (opts.json) deps.out.log(JSON.stringify(result, null, 2));
        else for (const line of result.lines) deps.out.log(line);
        if (result.report.findings.length > 0) deps.setExitCode(1);
        else if (result.report.measured === 0 && result.report.unresolved > 0) {
          deps.out.error('✗ 대비를 잰 묶음이 없고 못 잰 묶음이 남아 있다 — 깨끗한 결과가 아니다');
          deps.setExitCode(1);
        }
      } catch (error) {
        deps.out.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
        deps.setExitCode(1);
      }
    });
  repo.command('design-css <design-md>')
    .description('씨앗 DESIGN.md 에서 «CSS 토큰»을 생성한다 — ⛔ 잰 값만 낸다(못 뽑은 칸은 주석으로 말한다)')
    .option('--out <file>', '쓸 파일 (기본: stdout)')
    .action(async (designPath: string, opts: { out?: string }) => {
      try {
        const { readFileSync, writeFileSync, statSync } = await import('node:fs');
        const { buildTokensCss } = await import('../design/seed-to-css.js');
        const seed = readFileSync(designPath, 'utf8');
        // ⭐ 「언제 잰 씨앗인가」를 «파일이 말하게» 한다 — 모르면 모른다고 적힌다
        let measuredAt: string | undefined;
        try { measuredAt = statSync(designPath).mtime.toISOString().slice(0, 10); } catch { /* 못 읽으면 안 적는다 */ }
        const result = buildTokensCss(seed, { source: designPath, measuredAt });
        if (opts.out) {
          writeFileSync(opts.out, result.css);
          deps.out.log(`◆ design-css — ${opts.out}`);
        } else {
          deps.out.log(result.css);
        }
        deps.out.log(`  뽑음        ${result.derived.length ? result.derived.join(' · ') : '⚪ 없다'}`);
        // ⛔ 「못 뽑음」을 «조용히» 넘기지 않는다 — 그 목록이 다음 사람의 할 일이다
        deps.out.log(`  ⚪ 못 뽑음   ${result.missing.length ? result.missing.join(' · ') : '없다'}`);
        // ⛔⭐ 「읽었는데 버렸다」는 «셋째» 칸이다 — 위의 「뽑음」 수가 그만큼 모자라다는 뜻이라
        //    「못 뽑음: 없다」와 «같이» 뜰 수 있다. 그래서 줄을 따로 둔다.
        if (result.unread.length) {
          deps.out.log(`  🚨 못 읽음   ${result.unread.join(' · ')}`);
        }
        // ⛔⭐⭐ 「씨앗이 스스로 못 쟀다고 적은 것」 — ***토큰 수와 «다른 축»이다.***
        //    🩸 나는 「값 1208」만 보고 「쓸 만하다」고 읽었는데, 그 씨앗은 「h1·h2·h3 를 못 쟀다」고
        //       «문서 안에» 적고 있었다. ⇒ 자가 그 문장을 «옮긴다».
        if (result.seedSaysUnmeasured.length) {
          deps.out.log('  🚨 씨앗이 «스스로» 못 쟀다고 적은 것 — ⛔ 토큰 수와 «다른 축»이다:');
          for (const u of result.seedSaysUnmeasured) deps.out.log(`               · ${u}`);
        }
      } catch (error) {
        deps.out.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
        deps.setExitCode(1);
      }
    });

  repo.command('design-lint <html-path>')
    .description('산출물(HTML+CSS)이 AI 기본값 냄새(anti-ai-slop P0)를 내는지 검사 — 씨앗 DESIGN.md 를 기준으로')
    .option('--css <file>', 'CSS 경로 (기본: 같은 폴더의 styles.css)')
    .option('--design <file>', '씨앗 DESIGN.md (기본: 같은 폴더)')
    .option('--json', '기계용 JSON')
    .action(async (htmlPath: string, opts: { css?: string; design?: string; json?: boolean }) => {
      // 독립 CLI 프로세스도 logs.db sink를 명시 등록해야 `design.lint` 원장이 조회된다.
      try {
        const { registerStandaloneLogSink } = await import('../domains/standalone-log-sink.js');
        await registerStandaloneLogSink('repo-design-lint');
      } catch { /* lint 결과는 관측 부트스트랩 실패와 무관하게 계속 출력한다 */ }
      // ⛔ 재구현하지 않는다 — `lint-artifact-run.ts` 가 정본이고 스크립트도 같은 것을 부른다.
      try {
        const { formatLintDesignRun, runLintDesign } = await import('../design/lint-artifact-run.js');
        const result = runLintDesign({ htmlPath, cssPath: opts.css, designPath: opts.design });
        if (opts.json) deps.out.log(JSON.stringify(result, null, 2));
        else for (const line of formatLintDesignRun(result)) deps.out.log(line);
        // ⛔ P0 는 «결과»다 — 0 이 아니면 종료 코드로 말한다(무인 게이트가 이것을 읽는다).
        if (result.p0Count > 0) deps.setExitCode(1);
      } catch (error) {
        deps.out.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
        deps.setExitCode(2);
      }
    });
  repo.command('design-archive <url>')
    .description('라이브 페이지의 «원문»(전체 캡처·html·css·js·에셋)을 보관하고 파생물·인덱스를 만든다 — ⛔ 원문 버킷은 «이름을 대야» 한다')
    .option('--out <dir>', '출력 뿌리 (기본: ./design-archive)')
    .option('--db <path>', 'sqlite 인덱스 (기본: ~/.monad/webclone.db)')
    .option('--archive-bucket <bucket>', '⛔ «비공개» 버킷 — 안 주면 원문은 로컬에만 남는다(기본값 없음)')
    .option('--upload', '올린다 — 안 주면 파생물도 «안 올린다»')
    .option('--profile <aws>', '~/.aws/credentials 프로필')
    .option('--port <n>', 'CDP 포트 (기본 9388)')
    .option('--json', '기계용 JSON')
    .action(async (url: string, opts: Record<string, string | boolean | undefined>) => {
      try {
        const { registerStandaloneLogSink } = await import('../domains/standalone-log-sink.js');
        await registerStandaloneLogSink('repo-design-archive');
      } catch { /* fail-open — 관측 배선이 명령을 막지 않는다 */ }
      // ⛔ 재구현하지 않는다 — `archive-run.ts` 가 정본이고 스크립트도 같은 것을 부른다.
      try {
        const record = await deps.runArchive({
          url,
          outRoot: typeof opts.out === 'string' ? opts.out : 'design-archive',
          dbPath: typeof opts.db === 'string' ? opts.db : undefined,
          archiveBucket: typeof opts.archiveBucket === 'string' ? opts.archiveBucket : undefined,
          upload: opts.upload === true,
          profile: typeof opts.profile === 'string' ? opts.profile : undefined,
          port: typeof opts.port === 'string' ? Number(opts.port) : undefined,
        });
        if (opts.json === true) deps.out.log(JSON.stringify(record, null, 2));
        else for (const line of formatArchiveRecord(record)) deps.out.log(line);
        // ⛔ 「아무것도 못 얻었다」를 종료 코드로 말한다 — 무인 호출자가 0 을 성공으로 읽는다.
        if (archiveObtainedNothing(record)) {
          deps.out.error('✗ 아무것도 못 얻었다 — 원문 0개 · 캡처 0바이트 · 토큰 없음');
          deps.setExitCode(1);
        } else if (typeof opts.archiveBucket === 'string' && opts.upload === true && record.archivedCount === 0) {
          deps.out.error('✗ 요청한 원문 보관이 이뤄지지 않았다 — --archive-bucket과 --upload를 확인하라');
          deps.setExitCode(1);
        }
      } catch (error) {
        deps.out.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
        deps.setExitCode(1);
      }
    });
  repo.command('publish [project-directory]')
    .description('프로젝트 디렉토리의 로컬 git 저장소를 점검한 뒤 확인 한 번으로 private GitHub 저장소를 만들고 현재 브랜치를 push')
    .action(async (target: string | undefined) => {
      try {
        const { registerStandaloneLogSink } = await import('../domains/standalone-log-sink.js');
        await registerStandaloneLogSink('repo-publish');
      } catch { /* publication remains available if observation bootstrap fails */ }
      const code = await runRepositoryPublish(target, deps);
      if (code !== 0) deps.setExitCode(code);
    });
}
