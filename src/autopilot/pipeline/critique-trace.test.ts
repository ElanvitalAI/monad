import { describe, it, expect, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { setFrameDir } from './frame-journal.js';
import { appendCritiqueTrace, readCritiqueTraces, readCritiqueSidecar, type CritiqueTraceMeta } from './critique-trace.js';

function meta(over: Partial<CritiqueTraceMeta> = {}): CritiqueTraceMeta {
  return {
    phaseId: 'task:p1', title: '기존 자산 조사', verdict: 'ungrounded', severity: 'critical',
    reuseMap: '- [실존] youtube-transcript.ts@src/...', existsCount: 2, total: 3, dropped: 0,
    groundConfidence: 'low', model: 'gpt-5.6-terra', runId: '2026-07-18T00:00:00.000Z',
    promptChars: 100, responseChars: 50, at: '2026-07-18T00:00:00.000Z', ...over,
  };
}

let dir: string | null = null;
afterEach(() => { setFrameDir(null); if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } } dir = null; });
function tmp(): void { dir = fs.mkdtempSync(join(os.tmpdir(), 'ct-')); setFrameDir(dir); }

describe('critique-trace — sol 입출력 sidecar(관측 보강)', () => {
  it('트레이스 메타 append + 원문 sidecar 분리', () => {
    tmp();
    appendCritiqueTrace('m1', meta(), { prompt: 'PROMPT_FULL', response: 'RESP_FULL' });
    const traces = readCritiqueTraces('m1');
    expect(traces).toHaveLength(1);
    expect(traces[0]!.verdict).toBe('ungrounded');
    expect(traces[0]!.existsCount).toBe(2);
    // 메타엔 chars, 원문은 sidecar
    expect(traces[0]!.promptChars).toBe(100);
    const sc = readCritiqueSidecar('m1', 'task:p1');
    expect(sc!.prompt).toBe('PROMPT_FULL');
    expect(sc!.response).toBe('RESP_FULL');
  });

  it('여러 페이즈 누적', () => {
    tmp();
    appendCritiqueTrace('m1', meta({ phaseId: 'task:p1' }), { prompt: 'a', response: 'b' });
    appendCritiqueTrace('m1', meta({ phaseId: 'task:p2', verdict: 'ok' }), { prompt: 'c', response: 'd' });
    const traces = readCritiqueTraces('m1');
    expect(traces.map((t) => t.verdict)).toEqual(['ungrounded', 'ok']);
    expect(readCritiqueSidecar('m1', 'task:p2')!.response).toBe('d');
  });

  it('원문 없이 메타만(sidecar 옵션)', () => {
    tmp();
    appendCritiqueTrace('m1', meta());
    expect(readCritiqueTraces('m1')).toHaveLength(1);
    expect(readCritiqueSidecar('m1', 'task:p1')).toBeNull();
  });

  it('malformed 라인 skip / 없는 미션 = 빈', () => {
    tmp();
    appendCritiqueTrace('m1', meta());
    fs.appendFileSync(join(dir!, 'm1.critique-trace.jsonl'), 'garbage\n', 'utf8');
    expect(readCritiqueTraces('m1')).toHaveLength(1);
    expect(readCritiqueTraces('nope')).toEqual([]);
    expect(readCritiqueSidecar('nope', 'x')).toBeNull();
  });

  it('★ 실존인데 ungrounded 케이스 식별 가능(오탐 진단)', () => {
    tmp();
    appendCritiqueTrace('m1', meta({ verdict: 'ungrounded', existsCount: 2 }));
    const t = readCritiqueTraces('m1')[0]!;
    // existsCount>0 인데 ungrounded = LLM 층 오탐 신호
    expect(t.verdict === 'ungrounded' && t.existsCount > 0).toBe(true);
    expect(t.reuseMap).toContain('[실존]');
  });
});
