import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  setFrameDir, frameDir, framePath, makeFrameId,
  appendFrame, readFrames, loadLatestFrame, nextSeq, readLlmSidecar,
} from './frame-journal.js';
import type { PipelineFrame } from './frame-types.js';
import { emptyBlackboard } from '../mission-build-coordinator.js';

function frame(seq: number, over: Partial<PipelineFrame> = {}): PipelineFrame {
  return {
    frameId: makeFrameId('m1', seq), missionId: 'm1', seq,
    stageIndex: seq, stage: 'research', status: 'done', timestamp: '2026-07-18T00:00:00.000Z',
    op: 'push', inputsSnapshot: emptyBlackboard(), version: 0, ...over,
  };
}

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(join(os.tmpdir(), 'pf-')); setFrameDir(dir); });
afterEach(() => { setFrameDir(null); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } });

describe('frame-journal — append-only 저널(관측 SoT)', () => {
  it('appendFrame → readFrames round-trip', () => {
    appendFrame(frame(0, { stage: 'research' }));
    appendFrame(frame(1, { stage: 'ground' }));
    const got = readFrames('m1');
    expect(got.map((f) => f.stage)).toEqual(['research', 'ground']);
    expect(got[0]!.frameId).toBe('m1:0');
  });

  it('경로는 미션별 flat JSONL', () => {
    expect(framePath('m1')).toBe(join(frameDir(), 'm1.jsonl'));
    appendFrame(frame(0));
    expect(fs.existsSync(framePath('m1'))).toBe(true);
  });

  it('malformed 라인 skip(리플레이 오염 방지)', () => {
    appendFrame(frame(0));
    fs.appendFileSync(framePath('m1'), 'not json\n{bad\n', 'utf8');
    appendFrame(frame(1));
    expect(readFrames('m1').map((f) => f.seq)).toEqual([0, 1]);
  });

  it('seq 순 정렬 반환', () => {
    appendFrame(frame(2)); appendFrame(frame(0)); appendFrame(frame(1));
    expect(readFrames('m1').map((f) => f.seq)).toEqual([0, 1, 2]);
  });

  it('nextSeq / loadLatestFrame', () => {
    expect(nextSeq('m1')).toBe(0);
    appendFrame(frame(0)); appendFrame(frame(1));
    expect(nextSeq('m1')).toBe(2);
    expect(loadLatestFrame('m1')!.seq).toBe(1);
  });

  it('LLM sidecar 원문 분리 저장·lazy load', () => {
    appendFrame(
      frame(0, { stage: 'decompose', llm: { model: 'sol', promptChars: 5, responseChars: 3 } }),
      { promptRaw: 'PROMPT', responseRaw: 'RESP' },
    );
    // 프레임엔 chars 만
    expect(readFrames('m1')[0]!.llm).toEqual({ model: 'sol', promptChars: 5, responseChars: 3 });
    // 원문은 sidecar
    const sc = readLlmSidecar('m1', 0);
    expect(sc!.promptRaw).toBe('PROMPT');
    expect(sc!.responseRaw).toBe('RESP');
  });

  it('없는 미션 = 빈 배열(fail-soft)', () => {
    expect(readFrames('nope')).toEqual([]);
    expect(loadLatestFrame('nope')).toBeNull();
    expect(readLlmSidecar('nope', 0)).toBeNull();
  });
});
