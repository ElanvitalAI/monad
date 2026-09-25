import { afterAll, describe, expect, it, spyOn } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as logsCli from '../src/cli/logs-cli.js';
import type { LogTarget } from '../src/cli/logs-cli.js';
import {
  canonicalQueuePath,
  countValidQueuedRecords,
  deferredQueuePathForTarget,
  formatForeignQueueScan,
  formatFlushResult,
  inspectDeferredQueueFile,
  isValidQueuedRecord,
  runOutboundFlush,
  scanForeignDeferredQueues,
} from './outbound-flush.js';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'outbound-flush-'));
  dirs.push(d);
  return d;
}

function writeJsonl(path: string, records: unknown[]): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function errorCodeOf(e: unknown): string | undefined {
  return e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : undefined;
}

function universe(name: string, stateDir: string): LogTarget {
  return { name, dbPath: join(stateDir, 'logs', 'logs.db') };
}

describe('scanForeignDeferredQueues — 우주 열거로 갇힌 큐를 센다', () => {
  it('prod/test 우주를 열거하고 옛 뿌리(~/source·~/scratchpad·~/.monad) 밖의 큐도 센다', () => {
    const root = tmp();
    const prodState = join(root, 'home', '.monad');
    const axonState = join(root, 'axon', '.monad-test');
    const outsideState = join(root, 'private', 'tmp', 'claude-501', 'scratchpad', 'launch2', '.monad-test');
    const prodQueue = join(prodState, 'conatus', 'outbound_deferred.jsonl');
    const axonQueue = join(axonState, 'conatus', 'outbound_deferred.jsonl');
    const outsideQueue = join(outsideState, 'conatus', 'outbound_deferred.jsonl');
    mkdirSync(join(prodState, 'conatus'), { recursive: true });
    mkdirSync(join(axonState, 'conatus'), { recursive: true });
    mkdirSync(join(outsideState, 'conatus'), { recursive: true });
    writeJsonl(prodQueue, [{ ts: '2026-09-18T00:00:00Z', kind: 'active', text: 'mine' }]);
    writeJsonl(axonQueue, [
      { ts: '2026-09-03T00:00:00Z', kind: 'codex-rotate', text: 'a1' },
      { ts: '2026-09-04T00:00:00Z', kind: 'codex-rotate', text: 'a2' },
    ]);
    writeFileSync(
      outsideQueue,
      JSON.stringify({ ts: '2026-09-05T00:00:00Z', kind: 'codex-rotate', text: 'b1' }) + '\nnot-json\n',
    );
    const targets = [
      universe('prod', prodState),
      universe('test:axon', axonState),
      universe('test:launch2', outsideState),
    ];
    expect(deferredQueuePathForTarget(targets[2]!)).toBe(outsideQueue);
    const beforeAxon = readFileSync(axonQueue, 'utf-8');
    const beforeOutside = readFileSync(outsideQueue, 'utf-8');
    const scan = scanForeignDeferredQueues({ activePath: prodQueue, targets });
    expect(scan.ok).toBe(true);
    if (!scan.ok) throw new Error('expected ok scan');
    expect(scan.population).toBe(3);
    expect(scan.files).toBe(2);
    expect(scan.items).toBe(3);
    expect(scan.paths).not.toContain(canonicalQueuePath(prodQueue));
    expect(scan.paths).toContain(canonicalQueuePath(axonQueue));
    expect(scan.paths).toContain(canonicalQueuePath(outsideQueue));
    expect(scan.paths.some((p) => p.includes('scratchpad/launch2/.monad-test'))).toBe(true);
    expect(readFileSync(axonQueue, 'utf-8')).toBe(beforeAxon);
    expect(readFileSync(outsideQueue, 'utf-8')).toBe(beforeOutside);
    expect(readFileSync(prodQueue, 'utf-8')).toContain('mine');
  });

  it('활성 큐는 갇힌 것으로 세지 않는다', () => {
    const root = tmp();
    const activeState = join(root, 'active-universe');
    const foreignState = join(root, 'pilot', '.monad-test');
    const activeQueue = join(activeState, 'conatus', 'outbound_deferred.jsonl');
    const foreignQueue = join(foreignState, 'conatus', 'outbound_deferred.jsonl');
    mkdirSync(join(activeState, 'conatus'), { recursive: true });
    mkdirSync(join(foreignState, 'conatus'), { recursive: true });
    writeJsonl(activeQueue, [{ ts: '2026-09-18T00:00:00Z', kind: 'active', text: 'mine' }]);
    writeJsonl(foreignQueue, [{ ts: '2026-09-03T00:00:00Z', kind: 'codex-rotate', text: 'a1' }]);
    const scan = scanForeignDeferredQueues({
      activePath: activeQueue,
      targets: [universe('self', activeState), universe('test:pilot', foreignState)],
    });
    expect(scan.ok).toBe(true);
    if (!scan.ok) throw new Error('expected ok scan');
    expect(scan.population).toBe(2);
    expect(scan.files).toBe(1);
    expect(scan.items).toBe(1);
    expect(scan.paths).toEqual([canonicalQueuePath(foreignQueue)]);
  });

  it('모집단(열거한 우주 수)을 값으로 내어 0건이 「없다」인지 「이만큼 보고 없다」인지 가른다', () => {
    const root = tmp();
    const emptyA = join(root, 'empty-a');
    const emptyB = join(root, 'empty-b');
    mkdirSync(emptyA, { recursive: true });
    mkdirSync(emptyB, { recursive: true });
    const scan = scanForeignDeferredQueues({
      activePath: join(root, 'active', 'conatus', 'outbound_deferred.jsonl'),
      targets: [universe('prod', emptyA), universe('test:empty', emptyB)],
    });
    expect(scan.ok).toBe(true);
    if (!scan.ok) throw new Error('expected ok scan');
    expect(scan.population).toBe(2);
    expect(scan.files).toBe(0);
    expect(scan.items).toBe(0);
    expect(scan.paths).toEqual([]);
    expect(formatForeignQueueScan(scan)).toBe('격리 우주 큐 0곳 · 0건 (모집단 2)');
    expect(formatForeignQueueScan(scan)).not.toBe('격리 우주 큐 못 셌다');
  });

  it('외부 큐는 읽기만 하고 보내거나 옮기거나 지우지 않는다', () => {
    const root = tmp();
    const foreignState = join(root, 'pilot', '.monad-test');
    const foreignQueue = join(foreignState, 'conatus', 'outbound_deferred.jsonl');
    mkdirSync(join(foreignState, 'conatus'), { recursive: true });
    writeJsonl(foreignQueue, [
      { ts: '2026-09-03T00:00:00Z', kind: 'codex-rotate', text: 'keep-me' },
    ]);
    const before = readFileSync(foreignQueue, 'utf-8');
    const scan = scanForeignDeferredQueues({
      activePath: join(root, 'active', 'conatus', 'outbound_deferred.jsonl'),
      targets: [universe('test:pilot', foreignState)],
    });
    expect(scan.ok).toBe(true);
    if (!scan.ok) throw new Error('expected ok scan');
    expect(scan.files).toBe(1);
    expect(scan.items).toBe(1);
    expect(readFileSync(foreignQueue, 'utf-8')).toBe(before);
    expect(inspectDeferredQueueFile(foreignQueue)).toBe('present');
  });

  it('열거 실패는 0이 아니라 unknown/error 이다', () => {
    const scan = scanForeignDeferredQueues({
      activePath: '/tmp/active-outbound_deferred.jsonl',
      resolveTargets: () => { throw new Error('registry exploded'); },
    });
    expect(scan.ok).toBe(false);
    if (scan.ok) throw new Error('expected failed scan');
    expect(scan.error).toContain('registry exploded');
    expect('files' in scan).toBe(false);
    expect('items' in scan).toBe(false);
    expect('population' in scan).toBe(false);
    expect(formatForeignQueueScan(scan)).toContain('못 셌다');
    expect(formatForeignQueueScan(scan)).not.toMatch(/0곳/);
  });

  it('resolveTargets 가 error 를 내면 0으로 접지 않는다', () => {
    const scan = scanForeignDeferredQueues({
      activePath: '/tmp/active-outbound_deferred.jsonl',
      resolveTargets: () => ({ targets: [], error: '인스턴스 레지스트리 손상' }),
    });
    expect(scan.ok).toBe(false);
    if (scan.ok) throw new Error('expected failed scan');
    expect(scan.error).toContain('인스턴스 레지스트리 손상');
    expect('population' in scan).toBe(false);
    expect(formatForeignQueueScan(scan)).toContain('못 셌다');
  });

  it('큐 파일이 있다고 열거됐는데 읽기 throw 면 unknown/error 이다', () => {
    const root = tmp();
    const state = join(root, 'pilot', '.monad-test');
    const queue = join(state, 'conatus', 'outbound_deferred.jsonl');
    mkdirSync(join(state, 'conatus'), { recursive: true });
    writeJsonl(queue, [{ ts: '2026-09-03T00:00:00Z', kind: 'codex-rotate', text: 'x' }]);
    chmodSync(queue, 0);
    try {
      const scan = scanForeignDeferredQueues({
        activePath: join(root, 'active.jsonl'),
        targets: [universe('test:pilot', state)],
      });
      expect(scan.ok).toBe(false);
      if (scan.ok) throw new Error('expected failed scan');
      expect(scan.error.length).toBeGreaterThan(0);
      expect('files' in scan).toBe(false);
      expect('population' in scan).toBe(false);
      expect(formatForeignQueueScan(scan)).toContain('못 셌다');
      expect(formatForeignQueueScan(scan)).not.toMatch(/0곳/);
    } finally {
      chmodSync(queue, 0o644);
    }
  });

  it('inspectDeferredQueueFile 는 ENOENT 만 부재로 보고 그 외는 throw 한다', () => {
    const root = tmp();
    const parent = join(root, 'no-access');
    const blocked = join(parent, 'blocked', 'conatus', 'outbound_deferred.jsonl');
    mkdirSync(join(parent, 'blocked', 'conatus'), { recursive: true });
    writeJsonl(blocked, [{ ts: '2026-09-03T00:00:00Z', kind: 'codex-rotate', text: 'x' }]);
    expect(inspectDeferredQueueFile(join(root, 'does-not-exist.jsonl'))).toBe('missing');
    chmodSync(parent, 0);
    try {
      let inspectErr: unknown;
      try {
        inspectDeferredQueueFile(blocked);
      } catch (e) {
        inspectErr = e;
      }
      expect(inspectErr).toBeDefined();
      expect(errorCodeOf(inspectErr)).toBe('EACCES');
      const scan = scanForeignDeferredQueues({
        activePath: join(root, 'active.jsonl'),
        targets: [universe('blocked', join(parent, 'blocked'))],
      });
      expect(scan.ok).toBe(false);
      if (scan.ok) throw new Error('expected failed scan');
      expect(scan.error).toMatch(/EACCES|permission denied/);
      expect('files' in scan).toBe(false);
      expect('population' in scan).toBe(false);
      expect(formatForeignQueueScan(scan)).toContain('못 셌다');
      expect(formatForeignQueueScan(scan)).not.toMatch(/0곳/);
    } finally {
      chmodSync(parent, 0o700);
    }
  });

  it('실제 우주와 symlink 별칭은 같은 큐를 한 번만 센다', () => {
    const root = tmp();
    const realState = join(root, 'real', 'home');
    mkdirSync(join(realState, 'conatus'), { recursive: true });
    mkdirSync(join(root, 'alias-parent-dir'), { recursive: true });
    const queue = join(realState, 'conatus', 'outbound_deferred.jsonl');
    writeJsonl(queue, [
      { ts: '2026-09-03T00:00:00Z', kind: 'codex-rotate', text: 'a1' },
      { ts: '2026-09-04T00:00:00Z', kind: 'codex-rotate', text: 'a2' },
    ]);
    symlinkSync(realpathSync(join(root, 'real')), join(root, 'alias-parent-dir', 'home-link'));
    const aliasState = join(root, 'alias-parent-dir', 'home-link', 'home');
    const aliasQueue = join(aliasState, 'conatus', 'outbound_deferred.jsonl');
    expect(canonicalQueuePath(aliasQueue)).toBe(canonicalQueuePath(queue));
    const before = readFileSync(queue, 'utf-8');
    const scan = scanForeignDeferredQueues({
      activePath: join(root, 'active', 'outbound_deferred.jsonl'),
      targets: [universe('real', realState), universe('alias', aliasState)],
    });
    expect(scan.ok).toBe(true);
    if (!scan.ok) throw new Error('expected ok scan');
    expect(scan.population).toBe(2);
    expect(scan.files).toBe(1);
    expect(scan.items).toBe(2);
    expect(scan.paths).toEqual([canonicalQueuePath(queue)]);
    expect(readFileSync(queue, 'utf-8')).toBe(before);
  });

  it('한 우주 권한 오류는 다른 우주 건수를 확정으로 내지 않는다', () => {
    const root = tmp();
    const okState = join(root, 'pilot', '.monad-test');
    const secretParent = join(root, 'secret-parent');
    const secretState = join(secretParent, 'universe');
    const foreign = join(okState, 'conatus', 'outbound_deferred.jsonl');
    mkdirSync(join(okState, 'conatus'), { recursive: true });
    mkdirSync(join(secretState, 'conatus'), { recursive: true });
    writeJsonl(foreign, [{ ts: '2026-09-03T00:00:00Z', kind: 'codex-rotate', text: 'a1' }]);
    writeJsonl(join(secretState, 'conatus', 'outbound_deferred.jsonl'), [
      { ts: '2026-09-03T00:00:00Z', kind: 'codex-rotate', text: 'hidden' },
    ]);
    chmodSync(secretParent, 0);
    try {
      const scan = scanForeignDeferredQueues({
        activePath: join(root, 'active.jsonl'),
        targets: [universe('ok', okState), universe('secret', secretState)],
      });
      expect(scan.ok).toBe(false);
      if (scan.ok) throw new Error('expected failed scan');
      expect(scan.error).toMatch(/EACCES|permission denied/);
      expect('files' in scan).toBe(false);
      expect('population' in scan).toBe(false);
    } finally {
      chmodSync(secretParent, 0o700);
    }
  });

  it('큐 경로 정규화 실패는 0이 아니라 unknown/error 이다', () => {
    const root = tmp();
    const state = join(root, 'loop-universe');
    mkdirSync(join(state, 'conatus'), { recursive: true });
    writeJsonl(join(state, 'conatus', 'outbound_deferred.jsonl'), [
      { ts: '2026-09-03T00:00:00Z', kind: 'codex-rotate', text: 'a1' },
    ]);
    const err = Object.assign(new Error('ELOOP: too many symbolic links'), { code: 'ELOOP' });
    const scan = scanForeignDeferredQueues({
      activePath: '/tmp/active-outbound_deferred.jsonl',
      targets: [universe('loop', state)],
      realpath: () => { throw err; },
    });
    expect(scan.ok).toBe(false);
    if (scan.ok) throw new Error('expected failed scan');
    expect(scan.error).toMatch(/ELOOP|symbolic links/);
    expect('files' in scan).toBe(false);
    expect('population' in scan).toBe(false);
    expect(formatForeignQueueScan(scan)).toContain('못 셌다');
  });

  it('find/spawn 으로 파일시스템을 훑지 않고 resolveLogTargets 로 열거한다', () => {
    const src = readFileSync(new URL('./outbound-flush.ts', import.meta.url), 'utf-8');
    expect(src).not.toMatch(/spawnSync/);
    expect(src).not.toMatch(/['"]find['"]/);
    expect(src).toContain('resolveLogTargets');
    expect(src).toContain("conatusPath(DEFERRED_QUEUE_FILENAME)");
    const received: Array<{ all?: boolean; includeTest?: boolean }> = [];
    const root = tmp();
    const state = join(root, 'u');
    mkdirSync(join(state, 'conatus'), { recursive: true });
    writeJsonl(join(state, 'conatus', 'outbound_deferred.jsonl'), [
      { ts: '2026-09-03T00:00:00Z', kind: 'codex-rotate', text: 'a1' },
    ]);
    const spy = spyOn(logsCli, 'resolveLogTargets').mockImplementation((opts) => {
      received.push({ all: opts.all, includeTest: opts.includeTest });
      return { targets: [universe('u', state)] };
    });
    try {
      const scan = scanForeignDeferredQueues({
        activePath: join(root, 'active.jsonl'),
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(received).toHaveLength(1);
      expect(received[0]?.all).toBe(true);
      expect(received[0]?.includeTest).toBe(true);
      expect(scan.ok).toBe(true);
      if (!scan.ok) throw new Error('expected ok scan');
      expect(scan.population).toBe(1);
      expect(scan.files).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('countValidQueuedRecords — 실제 큐 레코드만 센다', () => {
  it('정상 레코드는 포함하고 빈 객체·필드 누락·타입 오류는 제외한다', () => {
    const root = tmp();
    const path = join(root, 'outbound_deferred.jsonl');
    writeFileSync(path, [
      JSON.stringify({ ts: '2026-09-03T00:00:00Z', kind: 'codex-rotate', text: 'ok' }),
      JSON.stringify({}),
      JSON.stringify({ ts: '2026-09-03T00:00:00Z', kind: 'codex-rotate' }),
      JSON.stringify({ ts: 1, kind: 'codex-rotate', text: 'bad-ts' }),
      JSON.stringify({ ts: '2026-09-03T00:00:00Z', kind: 2, text: 'bad-kind' }),
      JSON.stringify({ ts: '2026-09-03T00:00:00Z', kind: 'codex-rotate', text: 3 }),
      JSON.stringify({ ts: '', kind: 'codex-rotate', text: 'empty-ts' }),
      'not-json',
      JSON.stringify({ ts: '2026-09-04T00:00:00Z', kind: 'alert', text: 'also-ok', origin: { channel: 'telegram' } }),
    ].join('\n') + '\n');
    expect(countValidQueuedRecords(path)).toBe(2);
    expect(isValidQueuedRecord({ ts: '2026-09-03T00:00:00Z', kind: 'codex-rotate', text: 'ok' })).toBe(true);
    expect(isValidQueuedRecord({})).toBe(false);
    expect(isValidQueuedRecord({ ts: 'x', kind: 'y' })).toBe(false);
    expect(isValidQueuedRecord({ ts: 1, kind: 'y', text: 'z' })).toBe(false);
  });
});

describe('runOutboundFlush — 플러시 결과에 격리 큐를 같이 말한다', () => {
  it('0건 플러시에도 격리 파일·건수·모집단을 붙인다', () => {
    const lines: string[] = [];
    const result = runOutboundFlush({
      quiet: false,
      flush: () => 0,
      scan: () => ({ ok: true, population: 370, files: 3, items: 21, paths: ['a', 'b', 'c'] }),
      log: (m) => { lines.push(m); },
    });
    expect(result.flushed).toBe(0);
    expect(lines[0]).toBe(formatFlushResult(0));
    expect(lines[1]).toBe('격리 우주 큐 3곳 · 21건 (모집단 370)');
  });

  it('훑기가 죽어도 플러시 결과 보고는 끝난다', () => {
    const lines: string[] = [];
    let flushedCalled = false;
    const result = runOutboundFlush({
      quiet: false,
      flush: () => { flushedCalled = true; return 2; },
      scan: () => { throw new Error('scan down'); },
      log: (m) => { lines.push(m); },
    });
    expect(flushedCalled).toBe(true);
    expect(result.flushed).toBe(2);
    expect(result.scan && result.scan.ok).toBe(false);
    expect(lines[0]).toBe('야간 보류 2건 일괄 발송');
    expect(lines[1]).toContain('못 셌다');
    expect(lines[1]).toContain('scan down');
  });

  it('scanForeignDeferredQueues 가 ok:false 여도 로컬 flush 는 이미 끝났다', () => {
    const lines: string[] = [];
    let flushedCalled = false;
    const result = runOutboundFlush({
      quiet: false,
      flush: () => { flushedCalled = true; return 4; },
      scan: () => ({ ok: false, error: 'spawnSync find ETIMEDOUT' }),
      log: (m) => { lines.push(m); },
    });
    expect(flushedCalled).toBe(true);
    expect(result.flushed).toBe(4);
    expect(result.scan && result.scan.ok).toBe(false);
    expect(lines[0]).toBe('야간 보류 4건 일괄 발송');
    expect(lines[1]).toContain('못 셌다');
    expect(lines[1]).not.toMatch(/0곳/);
  });

  it('무음 창이면 플러시·훑기를 건너뛴다', () => {
    let flush = 0;
    let scan = 0;
    const lines: string[] = [];
    const result = runOutboundFlush({
      quiet: true,
      flush: () => { flush++; return 1; },
      scan: () => { scan++; return { ok: true, population: 0, files: 0, items: 0, paths: [] }; },
      log: (m) => { lines.push(m); },
    });
    expect(flush).toBe(0);
    expect(scan).toBe(0);
    expect(result.scan).toBeNull();
    expect(lines).toEqual(['아직 무음 창 — skip']);
  });
});
