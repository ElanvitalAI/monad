// Opportunistic followup (tool.diff slot · 2026-05-13) — daemon-side
// Edit tool tests.
//
// Invariants under test:
//  1. Successful edit returns EditResult with applied count + line
//     counts + structured hunks; the file on disk reflects the new
//     content.
//  2. tool.diff envelope is emitted (phase=end) only when ctx.emitFeedback
//     AND ctx.sessionId are both present. Skipping either keeps the
//     dispatch wire silent.
//  3. blockId = `${sessionId}:edit:${toolCallId-or-stamp}`; envelope
//     payload carries filePath + hunks + optional language.
//  4. Structured patch → DiffHunk{Line} translation preserves '+' and
//     '-' line counts; ctx lines convert with kind='ctx'.
//  5. Sensitive deny-list paths refuse (path-guard parity with Read).
//  6. Edit of a path outside cwd throws ToolSafetyError.
//  7. Edit of a directory throws ToolSafetyError.
//  8. Empty edits array throws ToolSafetyError.
//  9. old_string not found / multiple-matches (without replace_all)
//     throws ToolSafetyError and does NOT write the file (atomicity).
// 10. emit throw is swallowed — disk write + return still succeed.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  dispatchEdit,
  type EditResult,
} from '../src/boot/daemon-tools/edit.js';
import { dispatchWrite } from '../src/boot/daemon-tools/write.js';
import { debug } from '../src/debug/log.js';
import { setSessionCwd } from '../src/session/working-dir.js';
import {
  ToolSafetyError,
  type DaemonToolDispatchCtx,
} from '../src/boot/daemon-tools/types.js';
import type { FeedbackEnvelope } from '../src/feedback/envelope.js';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(joinPath(tmpdir(), 'monad-edit-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function makeCtx(
  overrides: Partial<DaemonToolDispatchCtx> = {},
): DaemonToolDispatchCtx {
  return {
    cwd,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function makeCollector(): {
  envelopes: FeedbackEnvelope[];
  emit: (env: FeedbackEnvelope) => void;
} {
  const envelopes: FeedbackEnvelope[] = [];
  return { envelopes, emit: (env) => envelopes.push(env) };
}

describe('dispatchEdit · happy path', () => {
  test('applies one substitution and returns hunks + writes file', async () => {
    writeFileSync(
      joinPath(cwd, 'note.ts'),
      'export const greet = "hello";\nexport const farewell = "bye";\n',
    );
    const r: EditResult = await dispatchEdit(
      {
        file_path: 'note.ts',
        edits: [{ old_string: '"hello"', new_string: '"hi"' }],
      },
      makeCtx(),
    );
    expect(r.applied).toBe(1);
    expect(r.linesAdded).toBeGreaterThan(0);
    expect(r.linesRemoved).toBeGreaterThan(0);
    expect(r.hunks.length).toBeGreaterThan(0);
    const written = readFileSync(joinPath(cwd, 'note.ts'), 'utf8');
    expect(written).toContain('"hi"');
    expect(written).not.toContain('"hello"');
  });

  test('replace_all replaces every occurrence', async () => {
    writeFileSync(
      joinPath(cwd, 'multi.txt'),
      'foo bar\nfoo baz\nfoo qux\n',
    );
    const r = await dispatchEdit(
      {
        file_path: 'multi.txt',
        edits: [{ old_string: 'foo', new_string: 'FOO', replace_all: true }],
      },
      makeCtx(),
    );
    expect(r.applied).toBe(3);
    const written = readFileSync(joinPath(cwd, 'multi.txt'), 'utf8');
    expect(written).toBe('FOO bar\nFOO baz\nFOO qux\n');
  });

  test('batch edits apply in order — second edit sees first edit result', async () => {
    writeFileSync(joinPath(cwd, 'two.txt'), 'A\nB\n');
    const r = await dispatchEdit(
      {
        file_path: 'two.txt',
        edits: [
          { old_string: 'A', new_string: 'X' },
          { old_string: 'B', new_string: 'Y' },
        ],
      },
      makeCtx(),
    );
    expect(r.applied).toBe(2);
    const written = readFileSync(joinPath(cwd, 'two.txt'), 'utf8');
    expect(written).toBe('X\nY\n');
  });
});

describe('dispatchEdit and dispatchWrite · live checkout observability', () => {
  test('records each successful direct daemon write when the harness boundary is inactive', async () => {
    debug.clear();
    const editPath = joinPath(cwd, 'edited.txt');
    const writePath = joinPath(cwd, 'written.txt');
    writeFileSync(editPath, 'before\n');

    await dispatchEdit(
      { file_path: 'edited.txt', edits: [{ old_string: 'before', new_string: 'after' }] },
      makeCtx({ sessionId: 'edit-session', toolCallId: 'edit-call' }),
    );
    await dispatchWrite(
      { file_path: 'written.txt', content: 'created\n' },
      makeCtx({ sessionId: 'write-session', toolCallId: 'write-call' }),
    );

    expect(readFileSync(editPath, 'utf8')).toBe('after\n');
    expect(readFileSync(writePath, 'utf8')).toBe('created\n');
    const writes = debug.events(20).filter((entry) =>
      entry.category === 'harness.boundary' && entry.event === 'live-checkout-write',
    );
    expect(writes).toHaveLength(2);
    expect(writes.map((entry) => entry.data)).toEqual(expect.arrayContaining([
      expect.objectContaining({ via: 'daemon-edit', path: expect.stringMatching(/edited\.txt$/), cwd, sessionId: 'edit-session', toolCallId: 'edit-call' }),
      expect.objectContaining({ via: 'daemon-write', path: expect.stringMatching(/written\.txt$/), cwd, sessionId: 'write-session', toolCallId: 'write-call' }),
    ]));
  });

  // ⛔ 무인 리뷰 should-fix ①(2026-08-05) — 「기록된다」만 고정하면 ***경계가 활성인데도 기록하는
  //   오탐***이 회귀로 들어와도 안 잡힌다. 「안 기록된다」를 같이 못 박는다.
  test('does NOT record when the session boundary is active (격리 checkout 오탐 방지)', async () => {
    debug.clear();
    writeFileSync(joinPath(cwd, 'bounded.txt'), 'before\n');
    setSessionCwd(cwd, 'tool', { boundary: true });
    try {
      await dispatchEdit(
        { file_path: 'bounded.txt', edits: [{ old_string: 'before', new_string: 'after' }] },
        makeCtx({ sessionId: 'bounded-session' }),
      );
      // 쓰기 자체는 «막지 않는다» — 이 골의 경계다(관측만 더한다).
      expect(readFileSync(joinPath(cwd, 'bounded.txt'), 'utf8')).toBe('after\n');
      const writes = debug.events(20).filter((entry) =>
        entry.category === 'harness.boundary' && entry.event === 'live-checkout-write',
      );
      expect(writes).toHaveLength(0);
    } finally {
      setSessionCwd(cwd, 'tool', { boundary: false });
    }
  });

  // ⛔ 무인 리뷰 should-fix ②(2026-08-05) — 관측 «전달»(`debug.log`)이 던져도 결과가 안 바뀐다.
  //
  // 🚨⭐⭐⭐ 이 주석의 초판은 «거짓»이었다 — *"가드(`getSessionBoundary`)가 `try` 밖에 있으면
  //   이 테스트가 던져서 실패한다. 즉 이 한 테스트가 ②③ 을 같이 문다"*.
  //   📏 실측(2026-08-08 · 무인 리뷰 지적 → `[T]` 가 옛 구현 재현 → `[S]` 가 독립 재현):
  //     가드를 `try` «밖»으로 되돌려도 이 파일은 ***17 pass***. ⇒ ***판별력 0.***
  //   🧩 기전: 이 테스트가 던지게 하는 것은 `debug.log` 인데, 그것은 «어느 판이든» `try` 안이다.
  //     ⇒ 가드가 밖으로 나가도 이 테스트에는 아무 일이 안 일어난다.
  // ⭐ 가드(=관측 «조회»)의 회귀는 `test/daemon-tools-boundary-failsoft.test.ts` 가 문다
  //   (그쪽은 `getSessionBoundary` «자체»를 던지게 한다 · edit·write 둘 다).
  test('관측 전달이 던져도 «완료된 write 의 결과»가 바뀌지 않는다 (fail-soft · 전달 축)', async () => {
    writeFileSync(joinPath(cwd, 'soft.txt'), 'before\n');
    const spy = spyOn(debug, 'log').mockImplementation(() => { throw new Error('log wire down'); });
    try {
      const r = await dispatchEdit(
        { file_path: 'soft.txt', edits: [{ old_string: 'before', new_string: 'after' }] },
        makeCtx({ sessionId: 'soft-session' }),
      );
      expect(r.applied).toBe(1);
      expect(readFileSync(joinPath(cwd, 'soft.txt'), 'utf8')).toBe('after\n');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('dispatchEdit · envelope emit', () => {
  test('phase=end envelope fires when ctx is fully wired', async () => {
    writeFileSync(joinPath(cwd, 'src.ts'), 'const a = 1;\n');
    const { envelopes, emit } = makeCollector();
    await dispatchEdit(
      {
        file_path: 'src.ts',
        edits: [{ old_string: 'const a = 1;', new_string: 'const a = 2;' }],
      },
      makeCtx({ emitFeedback: emit, sessionId: 's-1', toolCallId: 'tc-7' }),
    );
    expect(envelopes).toHaveLength(1);
    const env = envelopes[0]!;
    expect(env.kind).toBe('tool.diff');
    expect(env.phase).toBe('end');
    expect(env.blockId).toBe('s-1:edit:tc-7');
    expect(env.parentToolCallId).toBe('tc-7');
    const payload = env.payload as {
      filePath: string;
      language?: string;
      hunks: Array<{ lines: Array<{ kind: string }> }>;
    };
    expect(payload.filePath).toContain('src.ts');
    expect(payload.language).toBe('typescript');
    expect(payload.hunks.length).toBeGreaterThan(0);
    const lineKinds = payload.hunks.flatMap((h) => h.lines.map((l) => l.kind));
    expect(lineKinds).toContain('add');
    expect(lineKinds).toContain('del');
  });

  test('no emit when ctx.emitFeedback absent', async () => {
    writeFileSync(joinPath(cwd, 'a.txt'), 'x\n');
    const r = await dispatchEdit(
      { file_path: 'a.txt', edits: [{ old_string: 'x', new_string: 'y' }] },
      makeCtx(),
    );
    expect(r.applied).toBe(1);
    // No collector — absence-of-throw + correct return = no-emit proof.
  });

  test('no emit when ctx.sessionId missing (envelope schema requires it)', async () => {
    writeFileSync(joinPath(cwd, 'a.txt'), 'x\n');
    const { envelopes, emit } = makeCollector();
    await dispatchEdit(
      { file_path: 'a.txt', edits: [{ old_string: 'x', new_string: 'y' }] },
      makeCtx({ emitFeedback: emit /* no sessionId */ }),
    );
    expect(envelopes).toEqual([]);
  });

  test('asciiFallback contains the unified-diff representation', async () => {
    writeFileSync(joinPath(cwd, 'a.ts'), 'old\n');
    const { envelopes, emit } = makeCollector();
    await dispatchEdit(
      { file_path: 'a.ts', edits: [{ old_string: 'old', new_string: 'new' }] },
      makeCtx({ emitFeedback: emit, sessionId: 's-1' }),
    );
    const env = envelopes[0]!;
    expect(env.asciiFallback.length).toBeGreaterThan(0);
    expect(env.asciiFallback[0]).toMatch(/Edit /);
    expect(env.asciiFallback.some((l) => l.startsWith('@@'))).toBe(true);
  });
});

describe('dispatchEdit · safety', () => {
  test('refuses sensitive deny-list paths (.env)', async () => {
    writeFileSync(joinPath(cwd, '.env'), 'SECRET=1\n');
    await expect(
      dispatchEdit(
        { file_path: '.env', edits: [{ old_string: 'SECRET=1', new_string: 'SECRET=2' }] },
        makeCtx(),
      ),
    ).rejects.toThrow(ToolSafetyError);
    expect(readFileSync(joinPath(cwd, '.env'), 'utf8')).toBe('SECRET=1\n');
  });

  test('refuses path traversal escape', async () => {
    await expect(
      dispatchEdit(
        { file_path: '../escape', edits: [{ old_string: 'x', new_string: 'y' }] },
        makeCtx(),
      ),
    ).rejects.toThrow(ToolSafetyError);
  });

  test('refuses directory targets', async () => {
    mkdirSync(joinPath(cwd, 'a-dir'));
    await expect(
      dispatchEdit(
        { file_path: 'a-dir', edits: [{ old_string: 'x', new_string: 'y' }] },
        makeCtx(),
      ),
    ).rejects.toThrow(ToolSafetyError);
  });

  test('refuses empty edits array', async () => {
    writeFileSync(joinPath(cwd, 'a.txt'), 'x\n');
    await expect(
      dispatchEdit({ file_path: 'a.txt', edits: [] }, makeCtx()),
    ).rejects.toThrow(ToolSafetyError);
  });

  test('refuses old_string not found — file unchanged', async () => {
    writeFileSync(joinPath(cwd, 'a.txt'), 'alpha\n');
    await expect(
      dispatchEdit(
        { file_path: 'a.txt', edits: [{ old_string: 'NOPE', new_string: 'oops' }] },
        makeCtx(),
      ),
    ).rejects.toThrow(ToolSafetyError);
    expect(readFileSync(joinPath(cwd, 'a.txt'), 'utf8')).toBe('alpha\n');
  });

  test('refuses multiple matches without replace_all — atomic (no partial write)', async () => {
    writeFileSync(joinPath(cwd, 'multi.txt'), 'foo\nfoo\n');
    await expect(
      dispatchEdit(
        { file_path: 'multi.txt', edits: [{ old_string: 'foo', new_string: 'bar' }] },
        makeCtx(),
      ),
    ).rejects.toThrow(ToolSafetyError);
    expect(readFileSync(joinPath(cwd, 'multi.txt'), 'utf8')).toBe('foo\nfoo\n');
  });
});

describe('dispatchEdit · emit resilience', () => {
  test('throwing emitFeedback does not roll back the file write', async () => {
    writeFileSync(joinPath(cwd, 'a.ts'), 'old\n');
    let calls = 0;
    const r = await dispatchEdit(
      { file_path: 'a.ts', edits: [{ old_string: 'old', new_string: 'new' }] },
      makeCtx({
        sessionId: 's-1',
        emitFeedback: () => {
          calls++;
          throw new Error('wire down');
        },
      }),
    );
    expect(r.applied).toBe(1);
    expect(calls).toBe(1);
    expect(readFileSync(joinPath(cwd, 'a.ts'), 'utf8')).toBe('new\n');
  });
});
