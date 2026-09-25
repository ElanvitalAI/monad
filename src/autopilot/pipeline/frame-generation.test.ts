// H4 — 프레임 세대 스탬프(파티션) 검증. memo 시드로 TaskStore 무접촉.
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFrame, readFrames, setFrameDir } from './frame-journal.js';
import { appendExecFrame, readExecFrames } from './exec-frame-journal.js';
import { setMissionGenerationForTest, resetMissionGenerationMemoForTest } from '../lineage/mission-generation.js';
import type { PipelineFrame } from './frame-types.js';
import type { ExecutionFrame } from './exec-frame-types.js';

const MID = 'apm_gen-stamp-test_g4';
let dir: string;

const buildFrame = (over: Partial<PipelineFrame> = {}): PipelineFrame => ({
  frameId: `${MID}:1`, missionId: MID, seq: 1, stageIndex: 0, stage: 'research',
  status: 'done', timestamp: '2026-07-20T10:00:00Z', op: 'push', inputsSnapshot: {} as never, version: 0, ...over,
});
const execFrame = (over: Partial<ExecutionFrame> = {}): ExecutionFrame => ({
  frameId: `${MID}:exec:1`, missionId: MID, seq: 1, phaseId: 'p1', phaseTitle: 'T',
  op: 'phase-start', status: 'running', timestamp: '2026-07-20T10:00:00Z', version: 0, ...over,
});

describe('H4 — 프레임 세대 스탬프', () => {
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'frame-gen-')); setFrameDir(dir); resetMissionGenerationMemoForTest(); });
  afterEach(() => { setFrameDir(null); resetMissionGenerationMemoForTest(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

  it('build 프레임 — 미지정 generation 은 write 시점 세대로 스탬프', () => {
    setMissionGenerationForTest(MID, 3);
    appendFrame(buildFrame());
    expect(readFrames(MID)[0]?.generation).toBe(3);
  });

  it('build 프레임 — 명시 generation 은 보존(재스탬프 안 함)', () => {
    setMissionGenerationForTest(MID, 3);
    appendFrame(buildFrame({ generation: 7 }));
    expect(readFrames(MID)[0]?.generation).toBe(7);
  });

  it('exec 프레임 — 미지정 generation 스탬프', () => {
    setMissionGenerationForTest(MID, 2);
    appendExecFrame(execFrame());
    expect(readExecFrames(MID)[0]?.generation).toBe(2);
  });
});
