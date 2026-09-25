// ripgrep-core 단위테스트 — 공유 discovery 프리미티브(spawn 주입·에러 분류·인자 조립).
import { describe, test, expect } from 'bun:test';
import { rgListFiles, rgFilesWithMatches } from './ripgrep-core.js';

/** spawn seam mock — 넘어온 args 를 캡처하고 지정 결과 반환. */
function mockSpawn(result: Partial<{ status: number | null; signal: string | null; stdout: string; stderr: string; enoent: boolean; threw: string }> = {}) {
  const calls: string[][] = [];
  const spawn = (args: string[]) => {
    calls.push(args);
    return { status: 0, signal: null, stdout: '', stderr: '', ...result };
  };
  return { spawn, calls };
}

describe('rgListFiles — 파일 경로 discovery', () => {
  test('--files + --glob 인자 조립', () => {
    const m = mockSpawn({ stdout: 'src/a.ts\nsrc/b.ts\n' });
    const r = rgListFiles({ roots: ['/repo'], globs: ['**/a.ts', '**/b.*'], spawn: m.spawn });
    expect(r.ok).toBe(true);
    expect(r.paths).toEqual(['src/a.ts', 'src/b.ts']);
    expect(m.calls[0]).toEqual(['--files', '--glob', '**/a.ts', '--glob', '**/b.*', '/repo']);
  });

  test('noIgnore는 ignore 우회와 .git 제외 인자를 함께 추가한다', () => {
    const m = mockSpawn();
    rgListFiles({ roots: ['/repo'], noIgnore: true, spawn: m.spawn });
    expect(m.calls[0]).toEqual(['--files', '--no-ignore', '--hidden', '--glob', '!**/.git/**', '/repo']);
  });

  test('roots 빈 배열 → no-op(ok·빈 결과·spawn 미호출)', () => {
    const m = mockSpawn();
    const r = rgListFiles({ roots: [], spawn: m.spawn });
    expect(r).toEqual({ paths: [], ok: true });
    expect(m.calls.length).toBe(0);
  });

  test('status 1(무매칭) → ok·빈 결과', () => {
    const r = rgListFiles({ roots: ['/r'], spawn: mockSpawn({ status: 1, stdout: '' }).spawn });
    expect(r.ok).toBe(true);
    expect(r.paths).toEqual([]);
  });

  test('에러 분류 — enoent/timeout/invalid/spawn', () => {
    expect(rgListFiles({ roots: ['/r'], spawn: mockSpawn({ enoent: true }).spawn }).errorKind).toBe('missing-rg');
    expect(rgListFiles({ roots: ['/r'], spawn: mockSpawn({ signal: 'SIGTERM' }).spawn }).errorKind).toBe('timeout');
    expect(rgListFiles({ roots: ['/r'], spawn: mockSpawn({ status: 2, stderr: 'bad glob' }).spawn }).errorKind).toBe('invalid');
    expect(rgListFiles({ roots: ['/r'], spawn: mockSpawn({ threw: 'boom' }).spawn }).errorKind).toBe('spawn');
  });
});

describe('rgFilesWithMatches — 내용 매칭 파일 목록', () => {
  test('-l -w exact 인자', () => {
    const m = mockSpawn({ stdout: 'src/x.ts\n' });
    const r = rgFilesWithMatches('SignalPool', { roots: ['/r'], wholeWord: true, spawn: m.spawn });
    expect(r.paths).toEqual(['src/x.ts']);
    expect(m.calls[0]).toEqual(['-l', '-w', '--', 'SignalPool', '/r']);
  });

  test('noIgnore는 동기 파일 매칭 경로에도 전달한다', () => {
    const m = mockSpawn();
    rgFilesWithMatches('needle', { roots: ['/r'], noIgnore: true, spawn: m.spawn });
    expect(m.calls[0]).toEqual(['-l', '--no-ignore', '--hidden', '--glob', '!**/.git/**', '--', 'needle', '/r']);
  });

  test('-l -i similar 인자', () => {
    const m = mockSpawn({ stdout: '' });
    rgFilesWithMatches('signalpool', { roots: ['/r'], ignoreCase: true, spawn: m.spawn });
    expect(m.calls[0]).toEqual(['-l', '-i', '--', 'signalpool', '/r']);
  });

  test('fixed(-F) + globs(--glob) 인자', () => {
    const m = mockSpawn({ stdout: 'a.jsonl\n' });
    rgFilesWithMatches('lit.eral', { roots: ['/r'], fixed: true, ignoreCase: true, globs: ['*.jsonl'], spawn: m.spawn });
    expect(m.calls[0]).toEqual(['-l', '-i', '-F', '--glob', '*.jsonl', '--', 'lit.eral', '/r']);
  });

  test('빈 패턴 → no-op', () => {
    expect(rgFilesWithMatches('', { roots: ['/r'] })).toEqual({ paths: [], ok: true });
  });
});

import { rgFilesWithMatchesAsync } from './ripgrep-core.js';

describe('rgFilesWithMatchesAsync — 비동기 스트리밍(데몬 블로킹 회피)', () => {
  test('빈 패턴/빈 roots → no-op', async () => {
    expect(await rgFilesWithMatchesAsync('', { roots: ['/r'] })).toEqual({ paths: [], ok: true });
    expect(await rgFilesWithMatchesAsync('x', { roots: [] })).toEqual({ paths: [], ok: true });
  });

  test('실 rg — 이 파일 문자열 매칭(스모크·rg 환경만 강검)', async () => {
    const r = await rgFilesWithMatchesAsync('rgFilesWithMatchesAsync', { roots: [process.cwd() + '/src/tool-runtime'], ignoreCase: false, globs: ['*.ts'] });
    if (r.ok && r.paths.length) {
      expect(r.paths.some((p) => p.includes('ripgrep-core'))).toBe(true);
    }
  });
});

import { parseRgJsonMatches, parseRgJsonMatchLine, rgJsonMatchesAsync } from './ripgrep-core.js';

/** rg --json match 이벤트 1줄 생성. */
const matchLine = (path: string, line: number, text: string) =>
  JSON.stringify({ type: 'match', data: { path: { text: path }, line_number: line, lines: { text } } });

describe('parseRgJsonMatches — 공유 rg --json 파서(복붙 3벌 수렴)', () => {
  test('match 이벤트만 {path,line,text} 투영·비-match 스킵', () => {
    const stdout = [
      JSON.stringify({ type: 'begin', data: { path: { text: '/v/a.md' } } }),
      matchLine('/v/a.md', 3, 'hello OAuth world\n'),
      JSON.stringify({ type: 'end', data: {} }),
      'not json',
      matchLine('/v/b.md', 7, 'second\n'),
    ].join('\n');
    const out = parseRgJsonMatches(stdout, { relTo: '/v' });
    expect(out).toEqual([
      { path: 'a.md', line: 3, text: 'hello OAuth world' },   // relTo strip + trailing nl
      { path: 'b.md', line: 7, text: 'second' },
    ]);
  });

  test('snippetMax slice + limit break', () => {
    const stdout = [matchLine('/v/a.md', 1, 'x'.repeat(500)), matchLine('/v/b.md', 2, 'y'), matchLine('/v/c.md', 3, 'z')].join('\n');
    const out = parseRgJsonMatches(stdout, { relTo: '/v', snippetMax: 240, limit: 2 });
    expect(out.length).toBe(2);            // limit
    expect(out[0]!.text.length).toBe(240); // snippetMax
  });

  test('빈 stdout → []', () => {
    expect(parseRgJsonMatches('')).toEqual([]);
  });
});

describe('parseRgJsonMatchLine — per-line(streaming 공용·daemon-grep)', () => {
  test('match 이벤트 → {path,line,text}, 비-match/비-json → null', () => {
    expect(parseRgJsonMatchLine(matchLine('/x/a.md', 5, 'hit\n'), { pathFallback: '?' }))
      .toEqual({ path: '/x/a.md', line: 5, text: 'hit' });
    expect(parseRgJsonMatchLine(JSON.stringify({ type: 'begin', data: {} }))).toBeNull();
    expect(parseRgJsonMatchLine('not json')).toBeNull();
    expect(parseRgJsonMatchLine('  ')).toBeNull();
  });
  test('path 없으면 pathFallback', () => {
    const l = JSON.stringify({ type: 'match', data: { line_number: 1, lines: { text: 'x' } } });
    expect(parseRgJsonMatchLine(l, { pathFallback: '?' })!.path).toBe('?');
  });
});

describe('rgJsonMatchesAsync — spawn 주입', () => {
  test('code 0 → 파싱·ok', async () => {
    const r = await rgJsonMatchesAsync('q', {
      roots: ['/v'], relTo: '/v', noIgnore: true, spawn: async (args) => {
        expect(args).toContain('--json');
        expect(args).toContain('--no-ignore');
        expect(args).toContain('--hidden');
        expect(args).toContain('!**/.git/**');
        expect(args).toContain('q');
        return { code: 0, stdout: matchLine('/v/a.md', 1, 'hit\n'), stderr: '' };
      },
    });
    expect(r.ok).toBe(true);
    expect(r.matches).toEqual([{ path: 'a.md', line: 1, text: 'hit' }]);
  });

  test('code 1(무매치) → ok·빈', async () => {
    const r = await rgJsonMatchesAsync('q', { roots: ['/v'], spawn: async () => ({ code: 1, stdout: '', stderr: '' }) });
    expect(r.ok).toBe(true);
    expect(r.matches).toEqual([]);
  });

  test('code 2(에러) → ok:false·code/stderr', async () => {
    const r = await rgJsonMatchesAsync('q', { roots: ['/v'], spawn: async () => ({ code: 2, stdout: '', stderr: 'bad' }) });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(2);
    expect(r.stderr).toBe('bad');
  });

  test('빈 패턴/빈 roots → no-op', async () => {
    expect((await rgJsonMatchesAsync('', { roots: ['/v'] })).matches).toEqual([]);
    expect((await rgJsonMatchesAsync('q', { roots: [] })).matches).toEqual([]);
  });
});
