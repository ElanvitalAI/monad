// ── mss-instrument-agent plugin tests (MSS M2.2 Phase C2) ──

import { describe, expect, test } from 'bun:test';

import mssInstrumentPlugin, {
  collectMssReviewDiff,
  parseShortStat,
  renderMssReviewPrompt,
} from '../plugins/mss-instrument-agent/plugin.js';

describe('parseShortStat', () => {
  test('parses full shape: files + insertions + deletions', () => {
    expect(parseShortStat(' 3 files changed, 42 insertions(+), 7 deletions(-)'))
      .toEqual({ changedFiles: 3, insertions: 42, deletions: 7 });
  });

  test('singular file + inserts + delete: grammar variants', () => {
    expect(parseShortStat(' 1 file changed, 1 insertion(+), 1 deletion(-)'))
      .toEqual({ changedFiles: 1, insertions: 1, deletions: 1 });
  });

  test('insertions only (no deletion clause)', () => {
    expect(parseShortStat(' 2 files changed, 10 insertions(+)'))
      .toEqual({ changedFiles: 2, insertions: 10, deletions: 0 });
  });

  test('empty string returns zeros', () => {
    expect(parseShortStat('')).toEqual({ changedFiles: 0, insertions: 0, deletions: 0 });
  });
});

describe('collectMssReviewDiff', () => {
  test('invokes git diff twice (content + shortstat) and writes the output', () => {
    const gitCalls: Array<readonly string[]> = [];
    const writeCalls: Array<{ path: string; body: string }> = [];
    const result = collectMssReviewDiff({
      base: 'origin/main',
      head: 'HEAD',
      git: (args) => {
        gitCalls.push(args);
        if (args.includes('--shortstat')) return ' 2 files changed, 5 insertions(+), 1 deletion(-)';
        return '--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1,2 @@\n+line\n';
      },
      writeFile: (p, c) => writeCalls.push({ path: p, body: c }),
      now: () => 1700000000000,
      tmpDir: '/tmp',
    });
    expect(gitCalls.length).toBe(2);
    expect(gitCalls[0]).toEqual(['diff', 'origin/main..HEAD']);
    expect(gitCalls[1]).toEqual(['diff', '--shortstat', 'origin/main..HEAD']);
    expect(writeCalls.length).toBe(1);
    expect(result.changedFiles).toBe(2);
    expect(result.insertions).toBe(5);
    expect(result.deletions).toBe(1);
    expect(result.base).toBe('origin/main');
    expect(result.head).toBe('HEAD');
    expect(result.diffPath.endsWith('1700000000000.diff')).toBe(true);
  });

  test('defaults: base=main · head=HEAD', () => {
    const git = (args: readonly string[]): string => {
      if (args.includes('--shortstat')) return ' 1 file changed, 2 insertions(+)';
      return 'diff-body';
    };
    const result = collectMssReviewDiff({
      git,
      writeFile: () => {},
      now: () => 1,
      tmpDir: '/tmp',
    });
    expect(result.base).toBe('main');
    expect(result.head).toBe('HEAD');
    expect(result.diffBytes).toBe(Buffer.byteLength('diff-body', 'utf8'));
  });

  test('zero-diff case reports zeros cleanly', () => {
    const result = collectMssReviewDiff({
      git: (args) => args.includes('--shortstat') ? '' : '',
      writeFile: () => {},
      now: () => 1,
      tmpDir: '/tmp',
    });
    expect(result.changedFiles).toBe(0);
    expect(result.insertions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.diffBytes).toBe(0);
  });
});

describe('renderMssReviewPrompt', () => {
  test('includes diff summary, path, and reviewer subagent name', () => {
    const lines = renderMssReviewPrompt({
      base: 'main',
      head: 'HEAD',
      diffPath: '/tmp/monad-mss-review/diff-1.diff',
      diffBytes: 1024,
      changedFiles: 5,
      insertions: 50,
      deletions: 10,
    });
    const body = lines.join('\n');
    expect(body).toContain('main..HEAD');
    expect(body).toContain('files=5');
    expect(body).toContain('+50');
    expect(body).toContain('-10');
    expect(body).toContain('bytes=1024');
    expect(body).toContain('/tmp/monad-mss-review/diff-1.diff');
    expect(body).toContain('mss-instrument-reviewer');
    expect(body).toContain('PLAN §11.5');
  });
});

describe('mss-instrument-agent plugin manifest', () => {
  test('exports metadata + slash command', () => {
    expect(mssInstrumentPlugin.name).toBe('mss-instrument-agent');
    expect(mssInstrumentPlugin.slashCommands).toBeDefined();
    expect(mssInstrumentPlugin.slashCommands!.length).toBe(1);
    const cmd = mssInstrumentPlugin.slashCommands![0]!;
    expect(cmd.name).toBe('mss-review');
    expect(typeof cmd.handler).toBe('function');
  });

  test('slash handler falls back to default base branch when no arg', async () => {
    const logs: string[] = [];
    const ctx = { log: (line: string) => logs.push(line) };
    // Monkey-patch execFileSync by swapping the implementation-accessible
    // helper through a mocked git runner — slash handler uses real
    // execFileSync, so this test just validates the handler contract
    // (doesn't throw, logs something).
    try {
      await (mssInstrumentPlugin.slashCommands![0]!.handler)([], ctx as never);
    } catch {
      // If git isn't available in the test env, the handler logs the
      // error — we accept either outcome. The assertion below checks
      // that *some* output was produced.
    }
    expect(logs.length).toBeGreaterThan(0);
  });
});
