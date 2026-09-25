import { describe, expect, test } from 'bun:test';
import type { PtyDriveOpts } from '../src/cli/pty-drive-cli.js';
import { buildDevCliSpec, buildDriveAliasDevSpec } from '../src/self-dev/dev-cli.js';
import { runDevPipeline } from '../src/self-dev/dev-pipeline.js';
import { runDriveCliCommand } from '../src/cli/pty-drive-cli.js';

const opts = { goal: 'finish', maxSteps: '2', pollMs: '0' };

describe('shell drive reroute', () => {
  test('maps the legacy shell options to a shell-drive pipeline spec', () => {
    const spec = buildDevCliSpec({ text: 'printf done' }, { kind: 'self' }, {
      goal: 'finish', maxSteps: '2', pollMs: '0', model: 'test-model', cwd: '/work',
    });
    expect(spec.drive).toEqual({ command: 'printf done', goal: 'finish', maxSteps: 2, pollMs: 0, model: 'test-model', cwd: '/work' });
  });

  test('legacy alias preserves the required command and goal contracts', () => {
    expect(() => buildDriveAliasDevSpec(undefined, opts)).toThrow('drive: command 필요');
    expect(() => buildDriveAliasDevSpec('printf done', { maxSteps: '2', pollMs: '0' })).toThrow('drive: --goal 필요');
    expect(() => buildDriveAliasDevSpec('printf done', { ...opts, monad: true })).toThrow('drive: --monad 는 지원하지 않음');
  });

  test('runDevPipeline dispatches to runPtyDrive and preserves the numeric result exit code', async () => {
    const spec = buildDriveAliasDevSpec('printf done', opts);
    const seen: PtyDriveOpts[] = [];
    const result = await runDevPipeline(spec, {
      runPtyDrive: async (driveOpts) => { seen.push(driveOpts); return { exitCode: 7 }; },
    });
    expect(result.kind).toBe('shell-drive');
    if (result.kind !== 'shell-drive') throw new Error('expected shell-drive');
    expect(result.result.exitCode).toBe(7);
    expect(seen).toEqual([{ command: 'printf done', goal: 'finish', maxSteps: 2, pollMs: 0 }]);
  });

  // ── 3R must-fix ① 회귀 자물쇠 — "죽었지만 코드 모름"이 0 으로 접히지 않는다 ──
  // ⛔ 여기서 `?? 0` 이 되살아나면 실패가 "정상 완료" 로 읽히고, 이 PR 전체가 없애려던
  //    거짓말이 파이프라인 한 층 위에서 그대로 재발한다.
  test('runDevPipeline dispatches to runPtyDrive and preserves null instead of collapsing to 0', async () => {
    const spec = buildDriveAliasDevSpec('printf done', opts);
    const result = await runDevPipeline(spec, {
      runPtyDrive: async () => ({ exitCode: null }),
    });
    if (result.kind !== 'shell-drive') throw new Error('expected shell-drive');
    expect(result.result.exitCode).toBeNull();
  });

  test('the CLI boundary turns an unknown exit code into a failure, never 0', async () => {
    // 프로세스 경계는 숫자를 요구한다 — 그 숫자가 0 이면 안 된다는 것이 계약이다.
    let code: number | undefined;
    const errs: string[] = [];
    await runDriveCliCommand('printf done', opts, {
      runPtyDrive: async () => ({ exitCode: null }),
      exit: ((c: number) => { code = c; throw new Error('exit'); }) as never,
      writeError: ((m: string) => { errs.push(m); }) as never,
    } as never).catch(() => {});
    expect(code).toBe(1);
    expect(errs.join('')).toContain('without an exit code');
  });

  test('legacy spawn and pty auto names keep their previous contracts', async () => {
    expect(() => buildDriveAliasDevSpec('printf done', opts)).not.toThrow();
    const spec = buildDriveAliasDevSpec('printf done', opts);
    expect(spec.drive).toEqual({ command: 'printf done', goal: 'finish', maxSteps: 2, pollMs: 0 });
  });
});
