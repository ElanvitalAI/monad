import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { debug } from '../src/debug/log.js';
import {
  WorktreeCleanup,
  compareDiagnostics,
  installSignalCleanup,
  normalizeDiagnostics,
  parseTypecheckMeasurement,
  reportOutcome,
  runCommand,
  runComparison,
  unavailableOutcome,
  type CommandResult,
  type CommandRunner,
  type ComparisonFilesystem,
  type NormalizedDiagnostic,
} from '../scripts/tsc-baseline-comparison.js';

const diagnostic = (line: string, message?: string) => ({ file: 'src/example.ts', line, ...(message ? { message } : {}) });
const success = (stdout = ''): CommandResult => ({ status: 0, stdout, stderr: '' });
const error = (stderr: string, status = 1): CommandResult => ({ status, stdout: '', stderr });
const commit = 'a'.repeat(40);
const parsed = (root: string, message: string) => `${root}/src/example.ts(1,1): error TS2322: ${message.split('\n', 1)[0]}`;
const measurement = (root: string, message = 'known debt') => JSON.stringify({ version: 1, diagnostics: [{ line: parsed(root, message), message }] });
const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fakeFilesystem(lockfilesEqual = true): ComparisonFilesystem & { links: string[] } {
  const paths = new Set(['/repo/bun.lock', '/tmp/baseline/baseline/bun.lock', '/repo/node_modules']);
  const links: string[] = [];
  return {
    links,
    exists: (path) => paths.has(path),
    makeTemp: () => '/tmp/baseline',
    read: (path) => path.endsWith('bun.lock') ? (lockfilesEqual || path.startsWith('/repo') ? 'same' : 'different') : '',
    link: (source, destination) => { links.push(`${source} -> ${destination}`); paths.add(destination); },
    remove: (path) => { for (const candidate of [...paths]) if (candidate === path || candidate.startsWith(`${path}/`)) paths.delete(candidate); },
  };
}
function successfulRunner(overrides: Partial<Record<string, CommandResult>> = {}, commands: string[] = []): CommandRunner {
  return async (command, args, cwd) => {
    const key = `${command} ${args.join(' ')}`;
    commands.push(`${key} @ ${cwd}`);
    if (overrides[key]) return overrides[key]!;
    if (command === 'git' && args[0] === 'rev-parse') return success(`${commit}\n`);
    if (command === 'git' && args[0] === 'worktree' && args[1] === 'list') return success('worktree /repo\n\n');
    if (command === 'bun' && args.includes('--emit-typecheck-json')) return success(`${measurement(cwd)}\n`);
    return success();
  };
}

async function waitForLine(child: ReturnType<typeof spawn>, expected: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stdout = '';
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${expected}; stdout=${stdout}`)), 5_000);
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
      if (stdout.includes(expected)) { clearTimeout(timeout); resolve(); }
    });
    child.once('error', reject);
    child.once('close', (code) => reject(new Error(`child exited ${String(code)} before ${expected}; stdout=${stdout}`)));
  });
}

function waitForClose(child: ReturnType<typeof spawn>): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

describe('tsc baseline comparison', () => {
  it('normalisation preserves duplicate diagnostic counts while removing coordinates', () => {
    expect(normalizeDiagnostics([
      diagnostic('src/example.ts(1,2): error TS2322: broken'),
      diagnostic('src/example.ts(9,8): error TS2322: broken'),
    ], process.cwd())).toEqual([
      { file: 'src/example.ts', code: 'TS2322', message: 'broken' },
      { file: 'src/example.ts', code: 'TS2322', message: 'broken' },
    ]);
  });

  it('reports an added copy when the same diagnostic has a different count', () => {
    const baseline = normalizeDiagnostics([diagnostic('src/example.ts(1,2): error TS2322: broken')], process.cwd());
    const mine = normalizeDiagnostics([
      diagnostic('src/example.ts(3,4): error TS2322: broken'),
      diagnostic('src/example.ts(5,6): error TS2322: broken'),
    ], process.cwd());
    const outcome = compareDiagnostics(mine, baseline);
    expect(outcome.kind).toBe('added');
    expect(outcome.kind === 'added' && outcome.added).toHaveLength(1);
  });

  it('preserves complete multiline messages so equal first lines cannot cancel distinct diagnostics', () => {
    const root = '/repo';
    const first = 'Type X is not assignable.\n  Property alpha is missing.';
    const second = 'Type X is not assignable.\n  Property beta is missing.';
    const baseline = parseTypecheckMeasurement(measurement(root, first), root);
    const mine = parseTypecheckMeasurement(measurement(root, second), root);
    const outcome = compareDiagnostics(mine, baseline);
    expect(outcome.kind).toBe('added');
    expect(outcome.kind === 'added' && outcome.added[0]?.message).toBe(second);
    expect(outcome.kind === 'added' && outcome.removed[0]?.message).toBe(first);
  });

  it('rejects non-diagnostic or malformed measurement output', () => {
    expect(() => parseTypecheckMeasurement('warning: compiler crashed', '/repo')).toThrow('non-JSON');
    expect(() => parseTypecheckMeasurement(JSON.stringify({ version: 1, diagnostics: [], warning: 'partial' }), '/repo')).toThrow('invalid measurement envelope');
    expect(() => parseTypecheckMeasurement(JSON.stringify({ version: 1, diagnostics: [{ line: 'error TS5058: missing', message: 'missing' }] }), '/repo')).toThrow('unsupported diagnostic');
  });

  it('maps each of the four outcomes to one distinct report and exit code', () => {
    const item: NormalizedDiagnostic = { file: 'src/a.ts', code: 'TS1', message: 'bad' };
    const reports = [
      reportOutcome(compareDiagnostics([], [])),
      reportOutcome(compareDiagnostics([], [item])),
      reportOutcome(compareDiagnostics([item], [])),
      reportOutcome(unavailableOutcome('fetch failed')),
    ];
    expect(reports.map((report) => report.exitCode)).toEqual([0, 0, 1, 2]);
    expect(reports.map((report) => report.lines[0])).toEqual([
      '[tsc-baseline] CLEAN — no diagnostics were added.',
      '[tsc-baseline] CLEAN — no diagnostics were added; 1 diagnostic(s) removed.',
      '[tsc-baseline] ADDED — 1 diagnostic(s) added.',
      '[tsc-baseline] UNAVAILABLE — comparison was not made: fetch failed',
    ]);
  });

  it('accepts a validated TypeScript measurement only when the command exits zero with empty stderr', async () => {
    expect((await runComparison('/repo', [], { run: successfulRunner(), fs: fakeFilesystem() })).kind).toBe('clean');
    const run: CommandRunner = async (command, args, cwd, signal) => {
      if (command === 'bun' && args.includes('--emit-typecheck-json')) return { status: 0, stdout: measurement(cwd), stderr: 'unexpected warning' };
      return successfulRunner()(command, args, cwd, signal);
    };
    const outcome = await runComparison('/repo', [], { run, fs: fakeFilesystem() });
    expect(outcome.kind).toBe('unavailable');
    expect(outcome.kind === 'unavailable' && outcome.reason).toContain('unexpected stderr');
  });

  for (const [name, matcher] of [
    ['fetch', (command: string, args: string[]) => command === 'git' && args[0] === 'fetch'],
    ['worktree creation', (command: string, args: string[]) => command === 'git' && args[0] === 'worktree' && args[1] === 'add'],
    ['dependency install', (command: string, args: string[]) => command === 'bun' && args[0] === 'install'],
    ['baseline typecheck', (command: string, args: string[], cwd: string) => command === 'bun' && args.includes('--emit-typecheck-json') && cwd === '/tmp/baseline/baseline'],
    ['current typecheck', (command: string, args: string[], cwd: string) => command === 'bun' && args.includes('--emit-typecheck-json') && cwd === '/repo'],
  ] as const) {
    it(`turns failed ${name} into unavailable rather than clean`, async () => {
      const run: CommandRunner = async (command, args, cwd, signal) => {
        if (matcher(command, args, cwd)) return error(`${name} failed`);
        return successfulRunner()(command, args, cwd, signal);
      };
      const outcome = await runComparison('/repo', ['--baseline', 'main'], { run, fs: fakeFilesystem(name !== 'dependency install') });
      expect(outcome.kind).toBe('unavailable');
      expect(reportOutcome(outcome).exitCode).toBe(2);
    });
  }

  it('reuses current dependencies only for byte-identical lockfiles', async () => {
    const commands: string[] = [];
    const fs = fakeFilesystem(true);
    expect((await runComparison('/repo', [], { run: successfulRunner({}, commands), fs })).kind).toBe('clean');
    expect(fs.links).toEqual(['/repo/node_modules -> /tmp/baseline/baseline/node_modules']);
    expect(commands.some((command) => command.startsWith('bun install'))).toBeFalse();
  });

  // ⚠️ 사후 리뷰 should-fix(2026-07-28): 아래 둘은 **호출 형태와 관측 기록**을 직접 고정한다.
  //   그 둘이 조용히 깨지면 (a) 기준선이 stale 해도 통과하고 (b) verdict 를 로그로 재구성할 수 없다.
  it('fetches the baseline ref with an explicit refspec and verifies it resolved', async () => {
    const commands: string[] = [];
    expect((await runComparison('/repo', [], { run: successfulRunner({}, commands), fs: fakeFilesystem(true) })).kind).toBe('clean');
    // 명시 refspec 이 없으면 origin/<b> 가 갱신되지 않아 stale 기준선을 센다.
    // ⚠️ startsWith 는 잘못된 접미 인자도 통과시킨다(사후 리뷰 should-fix) — argv 를 정확히 단언한다.
    expect(commands).toContain('git fetch origin +refs/heads/main:refs/remotes/origin/main @ /repo');
    // fetch 성공만으로는 부족하다 — 그 ref 가 실제로 해석됐는지 확인해야 한다.
    expect(commands).toContain('git rev-parse --verify origin/main^{commit} @ /repo');
  });

  it('records the baseline ref, the dependency evidence, both counts and the verdict', async () => {
    const events: { event: string; data: Record<string, unknown> }[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'typecheck.baseline') events.push({ event, data: data ?? {} });
    }) as never);
    try {
      expect((await runComparison('/repo', [], { run: successfulRunner({}, []), fs: fakeFilesystem(true) })).kind).toBe('clean');
    } finally {
      log.mockRestore();
    }
    // ⚠️ 이벤트명만 보면 **빈 payload 도 통과**한다(사후 리뷰 must-fix) — 각 레코드의 필드까지 단언한다.
    const find = (event: string): Record<string, unknown> => {
      const hit = events.find((e) => e.event === event);
      expect(hit, `missing observation: ${event}`).toBeDefined();
      return hit!.data;
    };
    // 어느 ref 를 기준선으로 삼았나 — 셋 다 없으면 stale 기준선을 사후에 판별할 수 없다.
    expect(find('baseline-resolved')).toMatchObject({ branch: 'main', remoteRef: 'origin/main', commit });
    // 재사용/설치 중 무엇을 했나 ⊕ 그 근거. ⚠️ truthy 만 보면 임의 문자열도 통과한다(사후 리뷰 nit) —
    //   근거 문장을 정확히 고정한다(문장이 바뀌면 사후 판별의 의미도 바뀐다).
    expect(find('dependencies-reused')).toMatchObject({ evidence: 'bun.lock contents are byte-identical' });
    // 양쪽 진단 수 — ⚠️ typeof number 는 NaN 도 통과한다. 이 픽스처의 실제 값으로 고정한다.
    expect(find('diagnostics-counted')).toMatchObject({ baseline: 1, mine: 1 });   // 픽스처: 양쪽 1건이 상쇄 → clean
    expect(find('verdict')).toMatchObject({ verdict: 'clean', added: 0 });
  });

  it('installs baseline dependencies when lockfiles differ', async () => {
    const commands: string[] = [];
    const fs = fakeFilesystem(false);
    const run: CommandRunner = async (command, args, cwd, signal) => {
      const result = await successfulRunner({}, commands)(command, args, cwd, signal);
      if (command === 'bun' && args[0] === 'install') fs.link('/installed', '/tmp/baseline/baseline/node_modules');
      return result;
    };
    expect((await runComparison('/repo', [], { run, fs })).kind).toBe('clean');
    expect(commands.some((command) => command.startsWith('bun install --frozen-lockfile @ /tmp/baseline/baseline'))).toBeTrue();
  });

  it('attempts remove and prune even when worktree listing later fails', async () => {
    const commands: string[] = [];
    const run: CommandRunner = async (command, args, cwd) => {
      commands.push(`${command} ${args.join(' ')} @ ${cwd}`);
      if (args[1] === 'list') return error('list unavailable');
      return success();
    };
    const cleanup = new WorktreeCleanup('/repo', '/tmp/baseline', '/tmp/baseline/baseline', run, fakeFilesystem());
    await expect(cleanup.cleanup()).rejects.toThrow('verification list: list unavailable');
    expect(commands.some((command) => command.startsWith('git worktree remove --force'))).toBeTrue();
    expect(commands.some((command) => command.startsWith('git worktree prune --expire now'))).toBeTrue();
  });

  it('recovers a remove failure with filesystem removal and prune, then verifies no leak', async () => {
    let registered = true;
    const commands: string[] = [];
    const run: CommandRunner = async (command, args, cwd) => {
      commands.push(`${command} ${args.join(' ')} @ ${cwd}`);
      if (args[1] === 'remove') return error('locked worktree');
      if (args[1] === 'prune') { registered = false; return success(); }
      if (args[1] === 'list') return success(registered ? 'worktree /repo\n\nworktree /tmp/baseline/baseline\n\n' : 'worktree /repo\n\n');
      return success();
    };
    const cleanup = new WorktreeCleanup('/repo', '/tmp/baseline', '/tmp/baseline/baseline', run, fakeFilesystem());
    await cleanup.cleanup();
    expect(commands.some((command) => command.startsWith('git worktree prune --expire now'))).toBeTrue();
    expect(registered).toBeFalse();
  });

  it('waits for the active command before cleanup and exits once on an interrupt', async () => {
    const order: string[] = [];
    const handlers = new Map<string, () => void>();
    let finishCommand!: () => void;
    const commandDone = new Promise<void>((resolve) => { finishCommand = resolve; });
    const signals = {
      once: (signal: string, handler: () => void) => { handlers.set(signal, handler); },
      off: (signal: string) => { handlers.delete(signal); },
    };
    const uninstall = installSignalCleanup({
      abort: () => { order.push('abort'); },
      waitForCommand: async () => { order.push('wait'); await commandDone; order.push('stopped'); },
      cleanup: async () => { order.push('cleanup'); },
      exit: (code) => { order.push(`exit:${code}`); return undefined as never; },
      signals,
    });
    handlers.get('SIGINT')!();
    handlers.get('SIGINT')!();
    await Bun.sleep(0);
    expect(order).toEqual(['abort', 'wait']);
    finishCommand();
    await Bun.sleep(0);
    uninstall();
    expect(order).toEqual(['abort', 'wait', 'stopped', 'cleanup', 'exit:130']);
  });

  it('force-kills an uncooperative child after the abort timeout and resolves only after close', async () => {
    const controller = new AbortController();
    const pending = runCommand(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], process.cwd(), controller.signal, 40);
    await Bun.sleep(40);
    controller.abort();
    const result = await pending;
    expect(result.error?.message).toContain('interrupted');
    expect(result.status).toBeNull();
    expect(result.signal).toBe('SIGKILL');
  });

  it('handles a real SIGINT as abort, child-stop wait, cleanup, then exit', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tsc-baseline-signal-test-'));
    temporaryPaths.push(directory);
    const marker = join(directory, 'order.txt');
    const moduleUrl = pathToFileURL(join(process.cwd(), 'scripts/tsc-baseline-comparison.ts')).href;
    const source = `
      import { appendFileSync } from 'node:fs';
      import { installSignalCleanup } from ${JSON.stringify(moduleUrl)};
      const marker = ${JSON.stringify(marker)};
      installSignalCleanup({
        abort: () => appendFileSync(marker, 'abort\\n'),
        waitForCommand: async () => { appendFileSync(marker, 'wait\\n'); await Bun.sleep(40); appendFileSync(marker, 'stopped\\n'); },
        cleanup: async () => appendFileSync(marker, 'cleanup\\n'),
        exit: (code) => process.exit(code),
      });
      console.log('READY');
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ['-e', source], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    await waitForLine(child, 'READY');
    const closed = waitForClose(child);
    child.kill('SIGINT');
    const result = await closed;
    expect(result).toEqual({ code: 130, signal: null });
    expect(readFileSync(marker, 'utf8').trim().split('\n')).toEqual(['abort', 'wait', 'stopped', 'cleanup']);
  });
});
