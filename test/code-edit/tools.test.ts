import { describe, expect, test, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  dispatchRead, dispatchEdit, dispatchWrite,
  buildReadTool, buildEditTool, buildWriteTool,
  ReadFileStateStore,
  setPolicy, resetPolicyToDefault,
} from '../../src/code-edit/index.js';

beforeEach(() => setPolicy({ mode: 'unsupervised' }));
afterEach(() => resetPolicyToDefault());

const dirs: string[] = [];
function mkdir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ce-tools-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('tool specs', () => {
  test('Read spec has file_path required', () => {
    const s = buildReadTool();
    expect(s.name).toBe('Read');
    expect(s.parameters.required).toEqual(['file_path']);
  });

  test('Edit spec requires file_path + edits[]', () => {
    const s = buildEditTool();
    expect(s.name).toBe('Edit');
    expect(s.parameters.required).toEqual(['file_path', 'edits']);
    const props = s.parameters.properties as Record<string, any>;
    expect(props.edits.type).toBe('array');
    expect(props.edits.items.required).toEqual(['old_string', 'new_string']);
  });

  test('Write spec requires file_path + content', () => {
    const s = buildWriteTool();
    expect(s.name).toBe('Write');
    expect(s.parameters.required).toEqual(['file_path', 'content']);
  });

  test('Read description mentions offset/limit partial-view warning', () => {
    expect(buildReadTool().description.toLowerCase()).toContain('partial');
  });

  test('Edit description mentions the Read-before-Edit invariant', () => {
    expect(buildEditTool().description.toLowerCase()).toContain('read');
  });
});

describe('dispatchRead', () => {
  test('returns content with N-lines header', async () => {
    const d = mkdir();
    const p = join(d, 'a.txt');
    writeFileSync(p, 'one\ntwo\n');
    const store = new ReadFileStateStore();
    const r = await dispatchRead({ file_path: p }, store);
    expect(r.output).toContain(p);
    expect(r.output).toContain('lines');
    expect(r.output).toContain('one\ntwo\n');
  });

  test('missing file → Read failed: ...', async () => {
    const store = new ReadFileStateStore();
    const r = await dispatchRead({ file_path: '/does/not/exist.xyz' }, store);
    expect(r.output.startsWith('Read failed:')).toBe(true);
  });
});

describe('dispatchEdit', () => {
  test('happy path returns Update(path) summary + edit object', async () => {
    const d = mkdir();
    const p = join(d, 'f.ts');
    writeFileSync(p, 'const x = 1;\n');
    const store = new ReadFileStateStore();
    await dispatchRead({ file_path: p }, store);

    const r = await dispatchEdit({
      file_path: p,
      edits: [{ old_string: 'x = 1', new_string: 'x = 2' }],
    }, store);
    expect(r.output).toContain(`Update(${p})`);
    expect(r.output).toContain('+1 / -1');
    expect(r.edit?.ok).toBe(true);
    expect(r.edit?.linesAdded).toBe(1);
    expect(r.edit?.linesRemoved).toBe(1);
  });

  test('no prior Read → Edit failed: ...', async () => {
    const d = mkdir();
    const p = join(d, 'f.ts');
    writeFileSync(p, 'x');
    const store = new ReadFileStateStore();

    const r = await dispatchEdit({
      file_path: p,
      edits: [{ old_string: 'x', new_string: 'y' }],
    }, store);
    expect(r.output.startsWith('Edit failed:')).toBe(true);
    expect(r.edit).toBeUndefined();
  });

  test('coerces missing old/new_string to empty strings + surfaces error', async () => {
    const store = new ReadFileStateStore();
    const r = await dispatchEdit({ file_path: '/foo', edits: [{ old_string: 123 }] }, store);
    expect(r.output.startsWith('Edit failed:')).toBe(true);
  });

  // Self-healing 툴콜링(2026-07-11) — 부분 읽기(offset/limit) 후 Edit 는 원래 partialView
  // 가드로 막히지만, dispatchEdit 가 전체 재읽기 후 자동 재시도해 성공시킨다(codex 계열
  // 부분읽기 습관 대응). 미읽기(never-read)는 복구하지 않는다(아래 대조).
  test('partial-read (offset/limit) → Edit auto-recovers by re-reading full', async () => {
    const d = mkdir();
    const p = join(d, 'big.ts');
    writeFileSync(p, ['line0', 'line1', 'TARGET', 'line3', 'line4'].join('\n'));
    const store = new ReadFileStateStore();
    // 부분 읽기(offset/limit) — partialView=true 기록.
    await dispatchRead({ file_path: p, offset: 0, limit: 2 }, store);
    const r = await dispatchEdit({
      file_path: p,
      edits: [{ old_string: 'TARGET', new_string: 'FIXED' }],
    }, store);
    expect(r.edit?.ok).toBe(true);
    expect(r.output.startsWith('Edit failed:')).toBe(false);
  });

  test('never-read is NOT auto-recovered (invariant preserved)', async () => {
    const d = mkdir();
    const p = join(d, 'unread.ts');
    writeFileSync(p, 'TARGET');
    const store = new ReadFileStateStore();
    const r = await dispatchEdit({
      file_path: p,
      edits: [{ old_string: 'TARGET', new_string: 'FIXED' }],
    }, store);
    expect(r.output.startsWith('Edit failed:')).toBe(true);
  });
});

describe('dispatchWrite', () => {
  test('creates new file and returns Create(path) summary', async () => {
    const d = mkdir();
    const p = join(d, 'new.md');
    const store = new ReadFileStateStore();
    const r = await dispatchWrite({ file_path: p, content: 'hello\n' }, store);
    expect(r.output).toContain(`Create(${p})`);
    expect(r.edit?.ok).toBe(true);
  });

  test('overwrite path uses Write(path) verb when file existed', async () => {
    const d = mkdir();
    const p = join(d, 'existing.txt');
    writeFileSync(p, 'v1\n');
    const store = new ReadFileStateStore();
    await dispatchRead({ file_path: p }, store);
    const r = await dispatchWrite({ file_path: p, content: 'v2\n' }, store);
    expect(r.output).toContain(`Write(${p})`);
  });
});
