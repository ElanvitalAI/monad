import { afterEach, describe, expect, test } from 'bun:test';
import { decideTuiWorkdir, runPtyDrive } from '../src/cli/pty-drive-cli.js';
import { setElanousConfigDir, resetElanousConfigDir } from '../src/elanous-config-dir.js';
import { resetEffectiveInstanceRoot } from '../src/instance/resolve.js';
import { setPtyAdapterForTesting } from '../src/pty-shell/registry.js';
import { debug } from '../src/debug/log.js';

afterEach(() => {
  resetElanousConfigDir();
  resetEffectiveInstanceRoot();
  setPtyAdapterForTesting(null);
});

describe('isolated TUI workdir decision', () => {
  test('[refuse] rejects an isolated TUI without an explicit workdir before spawning', async () => {
    const isolatedRoot = '/tmp/pty-drive-workdir-isolated';
    const records: Array<{ category: string; event: string; data?: Record<string, unknown> }> = [];
    let spawnCalls = 0;
    setElanousConfigDir(isolatedRoot);
    resetEffectiveInstanceRoot();
    setPtyAdapterForTesting(() => {
      spawnCalls += 1;
      throw new Error('must not spawn');
    });
    const off = debug.registerSink({
      name: 'isolated-workdir-refusal-capture',
      emit: (rec) => records.push({ category: rec.category, event: rec.event, data: rec.data as Record<string, unknown> }),
    });
    const wasEnabled = debug.enabled;
    debug.enable();
    try {
      await expect(runPtyDrive({ elanous: true, goal: 'x', out: () => {} }))
        .rejects.toThrow('--cwd <worktree-path>');
    } finally {
      off();
      if (!wasEnabled) debug.disable();
    }
    expect(spawnCalls).toBe(0);
    expect(records.find((record) => record.category === 'pty.drive' && record.event === 'tui-workdir-decision')?.data)
      .toMatchObject({ isolated: true, workdirProvided: false, rejected: true });
  });

  // ⛔⭐⭐⭐ 무인 리뷰 must-fix — 판정이 `opts.elanous` 에 걸려 있으면 **비-elanous 경로**가 샌다.
  //    초판이 정확히 그랬고, 이 검사가 없어서 못 잡았다. 실제 `runPtyDrive` 를 태운다.
  test('[refuse-non-elanous] 비-elanous 경로도 명시 격리 ⊕ cwd 없음이면 거부한다', async () => {
    let spawnCalls = 0;
    setElanousConfigDir('/tmp/pty-drive-workdir-isolated-nonelanous');
    resetEffectiveInstanceRoot();
    setPtyAdapterForTesting(() => { spawnCalls += 1; throw new Error('must not spawn'); });
    await expect(runPtyDrive({ command: 'echo hi', out: () => {} } as never))
      .rejects.toThrow('--cwd <worktree-path>');
    expect(spawnCalls).toBe(0);
  });

  // ⛔⭐⭐⭐ 무인 리뷰 should-fix — **가장 중요한 무회귀**(비격리·주변격리는 종전대로)를
  //    순수 함수가 아니라 **실제 `runPtyDrive` 경로**에서 고정한다. 이게 없으면 규칙이 넓어져도 침묵한다.
  test('[allow-prod-runtime] 주변 격리(트리 파생)는 cwd 없이도 거부되지 않는다', async () => {
    resetElanousConfigDir();          // 명시 플래그 없음 ⇒ 트리 파생/기본
    resetEffectiveInstanceRoot();
    setPtyAdapterForTesting(() => { throw new Error('must not reach spawn in this assertion'); });
    // ⭐ 뒤 단계(goal 검증)에서 막히는 것이 **거부를 안 당했다는 증거**다. LLM 을 태우지 않고
    //    «작업 디렉토리 거부가 안 걸렸다» 만 잰다 — 이 검사의 목적이 정확히 그 무회귀다.
    let message = '';
    try { await runPtyDrive({ command: 'echo hi', out: () => {} } as never); }
    catch (e) { message = String((e as Error).message); }
    expect(message).not.toContain('--cwd <worktree-path>');
    expect(message).toContain('goal');            // 종전 경로의 검증에 도달했다
  });

  test('[allow-isolated] permits an isolated TUI with an explicit workdir', () => {
    expect(decideTuiWorkdir(true, '/tmp/isolated-worktree')).toEqual({
      isolated: true,
      workdirProvided: true,
      rejected: false,
    });
  });

  test('[allow-prod] permits a production-universe TUI without an explicit workdir', () => {
    expect(decideTuiWorkdir(false, undefined)).toEqual({
      isolated: false,
      workdirProvided: false,
      rejected: false,
    });
  });

  test('[message] tells the caller to provide --cwd', () => {
    expect(decideTuiWorkdir(true, undefined).message).toContain('--cwd <worktree-path>');
  });

  test('[observed] exposes only the workdir decision fields required for observation', () => {
    expect(decideTuiWorkdir(true, undefined)).toEqual({
      isolated: true,
      workdirProvided: false,
      rejected: true,
      message: expect.stringContaining('--cwd <worktree-path>'),
    });
  });
});

// ⛔⭐ 교차 세션 제안(2026-08-02) — 거부는 «무엇을 주면 되는지» 까지 말해야 한다.
//    상대가 헤맨 이유가 "어디에 config 를 쓰나" 였으므로 실효 자리 확인 수단도 함께 준다.
describe('거부 문면', () => {
  test('무엇을 주면 되는지와 어디서 확인하는지를 말한다', () => {
    const d = decideTuiWorkdir(true, undefined);
    expect(d.rejected).toBe(true);
    expect(d.message).toContain('--cwd <worktree-path>');
    expect(d.message).toContain('elanous where');
  });
});
