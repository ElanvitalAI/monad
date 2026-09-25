import { describe, it, expect, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { setFrameDir } from './frame-journal.js';
import { appendClarifyTrace, readClarifyTraces, readClarifySidecar, type ClarifyTraceMeta } from './clarify-trace.js';

function meta(over: Partial<ClarifyTraceMeta> = {}): ClarifyTraceMeta {
  return { phase: 'scope', count: 0, kinds: [], heavy: true, fallback: false, promptChars: 100, responseChars: 20, at: '2026-07-18T00:00:00.000Z', ...over };
}

let dir: string | null = null;
afterEach(() => { setFrameDir(null); if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } } dir = null; });
function tmp(): void { dir = fs.mkdtempSync(join(os.tmpdir(), 'clt-')); setFrameDir(dir); }

describe('clarify-trace — sol 입출력 sidecar(비결정성 진단)', () => {
  it('phase별 메타 append + 원문 sidecar', () => {
    tmp();
    appendClarifyTrace('m1', meta({ phase: 'scope', count: 0 }), { prompt: 'SCOPE_PROMPT', response: '[]' });
    appendClarifyTrace('m1', meta({ phase: 'arc', count: 1, kinds: ['arc'] }), { prompt: 'ARC_PROMPT', response: '[{...}]' });
    const traces = readClarifyTraces('m1');
    expect(traces.map((t) => t.phase)).toEqual(['scope', 'arc']);
    expect(traces[0]!.count).toBe(0); // clear
    expect(readClarifySidecar('m1', 'scope')!.prompt).toBe('SCOPE_PROMPT');
    expect(readClarifySidecar('m1', 'arc')!.response).toBe('[{...}]');
  });

  it('★ 범위 0개(clear) 케이스 — "왜 범위 명확" 진단 가능', () => {
    tmp();
    appendClarifyTrace('m1', meta({ phase: 'scope', count: 0 }), { prompt: 'p', response: '[]' });
    const t = readClarifyTraces('m1')[0]!;
    expect(t.count).toBe(0);           // 범위 질문 0 = clear
    expect(t.fallback).toBe(false);    // fallback 전 원본 판정
    expect(readClarifySidecar('m1', 'scope')!.response).toBe('[]'); // sol 이 빈 배열 냄
  });

  it('fallback 강제 케이스 표기', () => {
    tmp();
    appendClarifyTrace('m1', meta({ phase: 'scope', count: 1, kinds: ['scope'], fallback: true }));
    expect(readClarifyTraces('m1')[0]!.fallback).toBe(true);
  });

  it('malformed skip / 없는 미션 = 빈', () => {
    tmp();
    appendClarifyTrace('m1', meta());
    fs.appendFileSync(join(dir!, 'm1.clarify-trace.jsonl'), 'garbage\n', 'utf8');
    expect(readClarifyTraces('m1')).toHaveLength(1);
    expect(readClarifyTraces('nope')).toEqual([]);
    expect(readClarifySidecar('nope', 'scope')).toBeNull();
  });
});
