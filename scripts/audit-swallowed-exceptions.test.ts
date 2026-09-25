import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, win32 } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  BASELINE_RELATIVE_PATH,
  INVENTORY_REFRESH_COMMAND,
  MISSING_BASELINE_STATUS,
  NEW_SILENT_STATUS,
  auditSwallowedExceptions,
  buildReport,
  checkSwallowedExceptions,
  classifySwallowedCatch,
  describeGitIgnoreScan,
  findingKey,
  hasReasonComment,
  main,
  renderSwallowedAudit,
  resolveGitDirPath,
  scanSwallowedExceptions,
  serializeSwallowedBaseline,
} from './audit-swallowed-exceptions';

const SILENT_SNIPPET = 'try { x(); } catch {}\n';

function captureLines(): { lines: string[]; write: (message: string) => void } {
  const lines: string[] = [];
  return { lines, write: (message) => lines.push(message) };
}

function initGitRepo(root: string): void {
  const run = (args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(0);
  };
  run(['init']);
  run(['config', 'user.email', 'audit@example.com']);
  run(['config', 'user.name', 'audit']);
}

function writeSource(root: string, rel: string, source = SILENT_SNIPPET): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, source);
}

describe('audit-swallowed-exceptions', () => {
  test('known-positive empty catch is silent when the try body has no observability or cleanup call', () => {
    const source = ['function run() {', '  try { doWork() } catch {}', '}'].join('\n');
    const findings = scanSwallowedExceptions(source, 'known-positive.ts');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe('known-positive.ts');
    expect(findings[0]?.line).toBe(2);
    expect(findings[0]?.column).toBeGreaterThan(0);
    expect(findings[0]?.category).toBe('silent');
    expect(classifySwallowedCatch({ tryText: 'doWork()', catchInner: '' })).toBe('silent');
  });

  test('known-negative reason-comment catch is not silent', () => {
    const source = [
      'function parse() {',
      '  try { doWork() } catch { /* 여기서는 무시해도 된다: parse errors are expected */ }',
      '}',
    ].join('\n');
    const findings = scanSwallowedExceptions(source, 'known-negative.ts');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).not.toBe('silent');
    expect(
      classifySwallowedCatch({
        tryText: 'doWork()',
        catchInner: ' /* 여기서는 무시해도 된다: parse errors are expected */ ',
      }),
    ).not.toBe('silent');
  });

  test('empty catch and reason-comment catch classify differently', () => {
    const empty = classifySwallowedCatch({ tryText: 'doWork()', catchInner: '' });
    const reasoned = classifySwallowedCatch({
      tryText: 'doWork()',
      catchInner: ' /* fail-soft: cache miss is expected */ ',
    });
    expect(empty).toBe('silent');
    expect(reasoned).not.toBe('silent');
    expect(empty).not.toBe(reasoned);
  });

  test('comment-only catch without a reason stays silent', () => {
    expect(hasReasonComment(' /* TODO */ ')).toBe(false);
    expect(hasReasonComment(' /* */ ')).toBe(false);
    expect(classifySwallowedCatch({ tryText: 'doWork()', catchInner: ' /* TODO */ ' })).toBe('silent');
    const findings = scanSwallowedExceptions('try { doWork() } catch { /* TODO */ }', 'tracker.ts');
    expect(findings).toEqual([
      expect.objectContaining({ file: 'tracker.ts', line: 1, category: 'silent' }),
    ]);
  });

  test('tracker comments with leftover text stay silent; actual swallow reasons do not', () => {
    expect(hasReasonComment(' /* TODO: report this error */ ')).toBe(false);
    expect(hasReasonComment(' /* NOTE: revisit */ ')).toBe(false);
    expect(
      classifySwallowedCatch({ tryText: 'doWork()', catchInner: ' /* TODO: report this error */ ' }),
    ).toBe('silent');
    expect(
      classifySwallowedCatch({ tryText: 'doWork()', catchInner: ' /* NOTE: revisit */ ' }),
    ).toBe('silent');
    expect(
      scanSwallowedExceptions('try { doWork() } catch { /* TODO: report this error */ }', 'todo-tracker.ts'),
    ).toEqual([
      expect.objectContaining({ file: 'todo-tracker.ts', line: 1, category: 'silent' }),
    ]);
    expect(
      scanSwallowedExceptions('try { doWork() } catch { /* NOTE: revisit */ }', 'note-tracker.ts'),
    ).toEqual([
      expect.objectContaining({ file: 'note-tracker.ts', line: 1, category: 'silent' }),
    ]);
    expect(hasReasonComment(' /* fail-soft: cache miss is expected */ ')).toBe(true);
    expect(
      classifySwallowedCatch({ tryText: 'doWork()', catchInner: ' /* fail-soft: cache miss is expected */ ' }),
    ).not.toBe('silent');
  });

  test('leading TODO or docs comments outside the catch do not suppress silent', () => {
    const source = [
      '// TODO: document this parser',
      '/* 모듈 개요: 이 파일은 파서를 담는다 */',
      'try { doWork() } catch {}',
    ].join('\n');
    const findings = scanSwallowedExceptions(source, 'leading-comment.ts');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe('silent');
  });

  test('classifies empty observability and cleanup catches from try-block call nodes', () => {
    expect(scanSwallowedExceptions('try { debug.log("x") } catch {}', 'obs.ts')).toEqual([
      expect.objectContaining({ file: 'obs.ts', line: 1, category: 'observability' }),
    ]);
    expect(scanSwallowedExceptions('try { handle.close() } catch {}', 'cleanup.ts')).toEqual([
      expect.objectContaining({ file: 'cleanup.ts', line: 1, category: 'cleanup' }),
    ]);
  });

  test('does not treat console.log/close/cleanup inside strings or comments as try signals', () => {
    expect(
      scanSwallowedExceptions('try { doWork("console.log"); hint("close"); note("cleanup") } catch {}', 'string.ts'),
    ).toEqual([
      expect.objectContaining({ file: 'string.ts', category: 'silent' }),
    ]);
    expect(
      scanSwallowedExceptions('try { /* console.log close cleanup */ doWork() } catch {}', 'try-comment.ts'),
    ).toEqual([
      expect.objectContaining({ file: 'try-comment.ts', category: 'silent' }),
    ]);
    expect(classifySwallowedCatch({
      tryText: 'doWork("console.log"); hint("close"); note("cleanup")',
      catchInner: '',
    })).toBe('silent');
  });

  test('same-line catch clauses keep distinct keys so a new silent fails --check', () => {
    const findings = scanSwallowedExceptions(
      'try { a() } catch {} try { b() } catch {}',
      'same-line.ts',
    );
    expect(findings).toHaveLength(2);
    expect(findings[0]?.line).toBe(findings[1]?.line);
    expect(findings[0]?.column).not.toBe(findings[1]?.column);
    const keys = findings.map(findingKey);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toMatch(/^same-line\.ts:\d+:\d+$/);
    expect(keys[1]).toMatch(/^same-line\.ts:\d+:\d+$/);

    const existing = keys[0]!;
    const fresh = keys[1]!;
    const failed = checkSwallowedExceptions([existing, fresh], new Set([existing]));
    expect(failed.exitCode).toBe(NEW_SILENT_STATUS);
    expect(failed.diagnostic).toContain(fresh);
    expect(failed.diagnostic).not.toContain(`  ${existing}`);
  });

  test('render lists counts and paths for observability, cleanup, and silent', () => {
    const report = buildReport([
      { file: 'src/obs.ts', line: 4, column: 2, category: 'observability' },
      { file: 'src/clean.ts', line: 8, column: 5, category: 'cleanup' },
      { file: 'src/quiet.ts', line: 15, column: 9, category: 'silent' },
    ]);
    const rendered = renderSwallowedAudit(report);
    expect(rendered).toContain('observability: 1');
    expect(rendered).toContain('cleanup: 1');
    expect(rendered).toContain('silent: 1');
    expect(rendered).toContain('src/obs.ts:4:2');
    expect(rendered).toContain('src/clean.ts:8:5');
    expect(rendered).toContain('src/quiet.ts:15:9');
    expect(rendered).toContain(INVENTORY_REFRESH_COMMAND);
    expect(rendered).toContain('git-ignore: unknown');
    expect(rendered).not.toContain('git-ignore: applied');
    expect(describeGitIgnoreScan(undefined)).toBe('git-ignore: unknown');
    expect(describeGitIgnoreScan('applied')).toBe('git-ignore: applied');
    expect(describeGitIgnoreScan('fallback')).toContain('SKIP_DIRS');
  });

  test('--check passes baseline silent debt and fails only a new silent finding', () => {
    const existing = findingKey({ file: 'src/debt.ts', line: 3, column: 1 });
    const pass = checkSwallowedExceptions([existing], new Set([existing]));
    expect(pass.exitCode).toBe(0);
    expect(pass.diagnostic).toContain('PASS');

    const fresh = findingKey({ file: 'src/new-silent.ts', line: 9, column: 4 });
    const failed = checkSwallowedExceptions([existing, fresh], new Set([existing]));
    expect(failed.exitCode).toBe(NEW_SILENT_STATUS);
    expect(failed.diagnostic).toContain('new-silent');
    expect(failed.diagnostic).toContain('src/new-silent.ts:9:4');
    expect(failed.diagnostic).not.toContain('src/debt.ts:3:1');
  });

  test('--check names a missing baseline and uses a distinct nonzero status', () => {
    const result = checkSwallowedExceptions([], null, BASELINE_RELATIVE_PATH);
    expect(result.exitCode).toBe(MISSING_BASELINE_STATUS);
    expect(result.exitCode).not.toBe(NEW_SILENT_STATUS);
    expect(result.exitCode).not.toBe(0);
    expect(result.diagnostic).toContain('missing-baseline');
    expect(result.diagnostic).toContain(BASELINE_RELATIVE_PATH);

    const errors: string[] = [];
    expect(main(['--check'], {
      report: buildReport([]),
      loadBaseline: () => null,
      error: (message) => errors.push(message),
    })).toBe(MISSING_BASELINE_STATUS);
    expect(errors.join('\n')).toContain('missing-baseline');
  });

  test('main reads SwallowedAuditIo.args for --check injection', () => {
    const errors: string[] = [];
    expect(main([], {
      args: ['--check'],
      report: buildReport([]),
      loadBaseline: () => null,
      error: (message) => errors.push(message),
    })).toBe(MISSING_BASELINE_STATUS);
    expect(errors.join('\n')).toContain('missing-baseline');
  });

  test('serializeSwallowedBaseline emits stable sorted silent keys and ignores other categories', () => {
    const findings = [
      { file: 'src/b.ts', line: 2, column: 1, category: 'silent' as const },
      { file: 'src/a.ts', line: 10, column: 1, category: 'silent' as const },
      { file: 'src/a.ts', line: 9, column: 4, category: 'silent' as const },
      { file: 'src/obs.ts', line: 1, column: 1, category: 'observability' as const },
      { file: 'src/clean.ts', line: 3, column: 2, category: 'cleanup' as const },
    ];
    const first = serializeSwallowedBaseline(buildReport(findings));
    const second = serializeSwallowedBaseline(buildReport([...findings].reverse()));
    expect(first).toBe(second);
    expect(first).toContain(`# ${INVENTORY_REFRESH_COMMAND}`);
    expect(first).toContain('src/a.ts:9:4');
    expect(first).toContain('src/a.ts:10:1');
    expect(first).toContain('src/b.ts:2:1');
    expect(first).not.toContain('src/obs.ts');
    expect(first).not.toContain('src/clean.ts');
    expect(first.indexOf('src/a.ts:9:4')).toBeLessThan(first.indexOf('src/a.ts:10:1'));
    expect(first.endsWith('\n')).toBe(true);
  });

  test('main generates an absent baseline and --check fails a silent finding the baseline does not list', () => {
    const root = mkdtempSync(join(tmpdir(), 'swallowed-exceptions-baseline-'));
    try {
      const existing = { file: 'src/debt.ts', line: 3, column: 1, category: 'silent' as const };
      const fresh = { file: 'src/new-silent.ts', line: 9, column: 4, category: 'silent' as const };
      const baselinePath = join(root, BASELINE_RELATIVE_PATH);
      expect(existsSync(baselinePath)).toBe(false);

      const errors: string[] = [];
      expect(main(['--check'], {
        root,
        report: buildReport([existing]),
        error: (message) => errors.push(message),
      })).toBe(MISSING_BASELINE_STATUS);
      expect(existsSync(baselinePath)).toBe(false);
      expect(errors.join('\n')).toContain('missing-baseline');

      const logs: string[] = [];
      expect(main([], {
        root,
        report: buildReport([existing]),
        log: (message) => logs.push(message),
      })).toBe(0);
      expect(existsSync(baselinePath)).toBe(true);
      const firstBytes = readFileSync(baselinePath);
      expect(firstBytes.toString('utf8')).toContain('src/debt.ts:3:1');
      expect(logs.join('\n')).toContain(BASELINE_RELATIVE_PATH);

      expect(main([], {
        root,
        report: buildReport([existing]),
        log: () => {},
      })).toBe(0);
      expect(readFileSync(baselinePath).equals(firstBytes)).toBe(true);

      expect(main(['--check'], {
        root,
        report: buildReport([existing]),
        log: () => {},
      })).toBe(0);

      const checkErrors: string[] = [];
      expect(main(['--check'], {
        root,
        report: buildReport([existing, fresh]),
        error: (message) => checkErrors.push(message),
      })).toBe(NEW_SILENT_STATUS);
      expect(checkErrors.join('\n')).toContain('new-silent');
      expect(checkErrors.join('\n')).toContain('src/new-silent.ts:9:4');
      expect(readFileSync(baselinePath).equals(firstBytes)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('gitignored build artifacts are excluded by one git process and stay stable with or without the artifact', () => {
    const root = mkdtempSync(join(tmpdir(), 'swallowed-gitignored-'));
    try {
      initGitRepo(root);
      writeFileSync(join(root, '.gitignore'), 'out/\n');
      writeSource(root, 'src/real.ts');
      writeSource(root, 'apps/pwa/out/chunk.js');
      expect(spawnSync('git', ['add', 'src/real.ts', '.gitignore'], { cwd: root }).status).toBe(0);

      const withOut = auditSwallowedExceptions(root);
      expect(withOut.gitIgnoreScan).toBe('applied');
      expect(withOut.findings.some((finding) => finding.file.includes('apps/pwa/out/'))).toBe(false);
      expect(withOut.findings.some((finding) => finding.file === 'src/real.ts' && finding.category === 'silent')).toBe(true);

      const withOutCheck = captureLines();
      expect(main(['--check'], {
        root,
        report: withOut,
        loadBaseline: () => new Set<string>(),
        error: withOutCheck.write,
      })).toBe(NEW_SILENT_STATUS);
      expect(withOutCheck.lines.join('\n')).toContain('new-silent');
      expect(withOutCheck.lines.join('\n')).not.toContain('apps/pwa/out/');
      expect(withOutCheck.lines.join('\n')).toContain('git-ignore: applied');

      rmSync(join(root, 'apps/pwa/out'), { recursive: true, force: true });
      const withoutOut = auditSwallowedExceptions(root);
      expect(withoutOut.gitIgnoreScan).toBe('applied');
      expect(withoutOut.counts.silent).toBe(withOut.counts.silent);
      expect(withoutOut.findings.map(findingKey).sort().join('\n')).toBe(
        withOut.findings.map(findingKey).sort().join('\n'),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // ⛔ 이 저장소는 linked worktree 를 «상시» 쓴다 — 하니스 자식이 전부 그 형태다.
  //    그때 `.git` 은 디렉터리가 «아니라» `gitdir: <경로>` 한 줄짜리 «파일»이다.
  //    🩸 초판은 그 경로를 `startsWith('/')` 로만 절대경로 판정해서 Windows 절대경로
  //    (`C:\…` · `C:/…`)를 놓쳤다 — 그러면 root 에 잘못 결합돼 조회가 실패하고
  //    ***조용히 fallback 으로 떨어져 빌드 산출물을 다시 훑는다***(이 판이 고치려던 그 상태).
  // ⛔ 이 시험이 «있는 이유»: 아래 실물 worktree 시험은 POSIX 에서만 돌고,
  //    거기선 gitdir 가 언제나 `/` 로 시작해 옛 코드(`startsWith('/')`)도 통과한다.
  //    ⇒ 반증이 «조용»하다(실측으로 확인했다). 그래서 판정을 순수 함수로 빼 «모양»으로 문다.
  // ⛔ 상대 `gitdir` 의 «실물» 시험은 두지 않는다 — `git worktree add` 가 그 형태를 안 만들고,
  //    손으로 만든 gitdir 는 git 이 거부해 fallback 이 된다(허구 조건이 된다).
  //    ⇒ 아래 «모양» 시험이 그 축(상대 경로 해석)을 덮는다. 이 skip 이 그 결정의 기록이다.
  test.skip('a linked worktree with a RELATIVE gitdir — covered by the shape test below', () => {
    // 의도적 공백. `resolveGitDirPath('/wt', 'gitdir-here')` 가 그 계약을 문다.
  });

  test('gitdir resolution treats WINDOWS absolute paths as absolute (not joinable)', () => {
    expect(resolveGitDirPath('/wt', '/repo/.git/worktrees/w')).toBe('/repo/.git/worktrees/w');
    // ⭐ 여기가 갈림 — 옛 코드는 이 둘을 «상대»로 읽어 root 에 붙였고,
    //    그러면 조회가 실패해 조용히 fallback → 빌드 산출물을 다시 훑는다.
    expect(resolveGitDirPath('/wt', 'C:\\repo\\.git\\worktrees\\w')).toBe('C:\\repo\\.git\\worktrees\\w');
    expect(resolveGitDirPath('/wt', 'C:/repo/.git/worktrees/w')).toBe('C:/repo/.git/worktrees/w');
    // 상대는 여전히 root 기준으로 푼다.
    expect(resolveGitDirPath('/wt', 'gitdir-here')).toBe(join('/wt', 'gitdir-here'));
  });

  test('a linked worktree (.git FILE with an absolute gitdir) still applies git-ignore', () => {
    const parent = mkdtempSync(join(tmpdir(), 'swallowed-wt-'));
    const root = join(parent, 'wt');
    try {
      initGitRepo(parent);
      // ⭐ 조건을 «진짜로» 만든다 — 손으로 만든 gitdir 는 git 이 거부해 fallback 이 된다.
      writeFileSync(join(parent, '.gitignore'), 'apps/pwa/out/\n', 'utf8');
      writeSource(parent, 'src/seed.ts');
      expect(spawnSync('git', ['add', '-A'], { cwd: parent }).status).toBe(0);
      expect(spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'seed'],
        { cwd: parent }).status).toBe(0);
      const added = spawnSync('git', ['worktree', 'add', '--detach', root], { cwd: parent });
      expect(added.status).toBe(0);

      // 실물 확인 — .git 이 «파일»이고 절대 gitdir 를 담는다.
      expect(statSync(join(root, '.git')).isFile()).toBe(true);
      // ⛔ `^gitdir:\s*/` 로 못 박으면 Windows Git 의 `gitdir: C:/…` 에서 «실패»한다.
      //    플랫폼 독립으로 — 「gitdir 줄이 있고 그 값이 «절대경로»다」만 문다.
      const gitdirLine = readFileSync(join(root, '.git'), 'utf8').match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
      expect(gitdirLine).toBeDefined();
      expect(isAbsolute(gitdirLine!) || win32.isAbsolute(gitdirLine!)).toBe(true);

      writeSource(root, 'src/real.ts');
      writeSource(root, 'apps/pwa/out/chunk.js');

      const report = auditSwallowedExceptions(root);
      // ⭐ 핵심 — fallback 이 «아니어야» 한다. fallback 이면 out/ 이 다시 잡힌다.
      expect(report.gitIgnoreScan).toBe('applied');
      expect(report.findings.some((f) => f.file === 'src/real.ts')).toBe(true);
      expect(report.findings.some((f) => f.file.includes('apps/pwa/out/'))).toBe(false);
    } finally {
      spawnSync('git', ['worktree', 'remove', '--force', root], { cwd: parent });
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test('git-less copy falls back to SKIP_DIRS and says so even when nested under another git tree', () => {
    const parent = mkdtempSync(join(tmpdir(), 'swallowed-parent-git-'));
    const root = join(parent, 'copy');
    try {
      initGitRepo(parent);
      writeSource(parent, 'src/parent-only.ts');
      expect(spawnSync('git', ['add', 'src/parent-only.ts'], { cwd: parent }).status).toBe(0);

      mkdirSync(root, { recursive: true });
      writeSource(root, 'src/real.ts');
      writeSource(root, 'node_modules/pkg/ignored.ts');
      writeSource(root, 'apps/pwa/out/chunk.js');
      expect(existsSync(join(root, '.git'))).toBe(false);

      const report = auditSwallowedExceptions(root);
      expect(report.gitIgnoreScan).toBe('fallback');
      expect(report.findings.some((finding) => finding.file === 'src/real.ts')).toBe(true);
      expect(report.findings.some((finding) => finding.file.includes('node_modules'))).toBe(false);
      expect(report.findings.some((finding) => finding.file.includes('apps/pwa/out/'))).toBe(true);
      expect(report.findings.some((finding) => finding.file.includes('parent-only'))).toBe(false);

      const rendered = renderSwallowedAudit(report);
      expect(rendered).toContain('git-ignore: fallback');
      expect(rendered).toContain('SKIP_DIRS');
      expect(rendered).not.toContain('git-ignore: applied');

      const check = captureLines();
      const status = main(['--check'], {
        root,
        report,
        loadBaseline: () => new Set<string>(),
        error: check.write,
        log: check.write,
      });
      expect(status).not.toBe(2);
      expect(Number.isFinite(status)).toBe(true);
      expect(check.lines.join('\n')).toContain('git-ignore: fallback');
      expect(check.lines.join('\n')).toContain('SKIP_DIRS');
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test('a planted silent catch in src/ still appears as new-silent after git-ignore filtering', () => {
    const root = mkdtempSync(join(tmpdir(), 'swallowed-planted-'));
    try {
      initGitRepo(root);
      writeSource(root, 'src/planted.ts');
      expect(spawnSync('git', ['add', 'src/planted.ts'], { cwd: root }).status).toBe(0);

      const report = auditSwallowedExceptions(root);
      expect(report.gitIgnoreScan).toBe('applied');
      expect(report.findings.some((finding) => finding.file === 'src/planted.ts' && finding.category === 'silent')).toBe(true);

      const check = captureLines();
      expect(main(['--check'], {
        root,
        report,
        loadBaseline: () => new Set<string>(),
        error: check.write,
      })).toBe(NEW_SILENT_STATUS);
      expect(check.lines.join('\n')).toContain('src/planted.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
