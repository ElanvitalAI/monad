// P1 — dispatchAutopilotMissions('pipeline') 백엔드 검증(status/stack·READ-ONLY).
import { describe, it, expect, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { dispatchAutopilotMissions } from '../mission-tool.js';
import { setFrameDir, appendFrame, makeFrameId } from './frame-journal.js';
import { emptyBlackboard, type BuildStage } from '../mission-build-coordinator.js';
import type { PipelineFrame } from './frame-types.js';

function fr(seq: number, stage: BuildStage, over: Partial<PipelineFrame> = {}): PipelineFrame {
  return {
    frameId: makeFrameId('m1', seq), missionId: 'm1', seq, stageIndex: seq, stage,
    status: 'done', timestamp: '2026-07-18T00:00:00.000Z', op: 'push',
    inputsSnapshot: emptyBlackboard(), version: 0, ...over,
  };
}

let dir: string | null = null;
afterEach(() => { setFrameDir(null); if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } } dir = null; });
function tmp(): void { dir = fs.mkdtempSync(join(os.tmpdir(), 'cli-pf-')); setFrameDir(dir); }

describe("dispatch pipeline (P1·CLI 백엔드·READ-ONLY)", () => {
  it('프레임 없으면 exists:false(무동작 안내)', async () => {
    tmp();
    const r = await dispatchAutopilotMissions({ action: 'pipeline', id: 'm1' }) as { exists: boolean; note: string };
    expect(r.exists).toBe(false);
    expect(r.note).toContain('pipelineFrames');
  });

  it('status(기본) — 현재위치 ENUM + 자기인지 진단(stuck·healable)', async () => {
    tmp();
    appendFrame(fr(0, 'research'));
    appendFrame(fr(1, 'ground'));
    appendFrame(fr(2, 'decompose', { status: 'failed' }));
    const r = await dispatchAutopilotMissions({ action: 'pipeline', id: 'm1', sub: 'status' }) as {
      exists: boolean; current: string; statuses: Record<string, string>; stuck: string[]; healable: boolean; recommendation: string;
    };
    expect(r.exists).toBe(true);
    expect(r.current).toBe('decompose');
    expect(r.statuses.research).toBe('done');
    expect(r.stuck).toContain('decompose');
    expect(r.healable).toBe(true);
    expect(r.recommendation).toContain('되감아');
  });

  it('stack — 프레임 목록(seq·op·hasLlm)', async () => {
    tmp();
    appendFrame(fr(0, 'research', { llm: { model: 'sol', promptChars: 1, responseChars: 1 } }));
    const r = await dispatchAutopilotMissions({ action: 'pipeline', id: 'm1', sub: 'stack' }) as {
      frameCount: number; frames: Array<{ seq: number; stage: string; hasLlm: boolean }>;
    };
    expect(r.frameCount).toBe(1);
    expect(r.frames[0]!.hasLlm).toBe(true);
    expect(r.frames[0]!.stage).toBe('research');
  });

  it('id 없으면 error', async () => {
    const r = await dispatchAutopilotMissions({ action: 'pipeline' }) as { error?: string };
    expect(r.error).toBeTruthy();
  });
});
