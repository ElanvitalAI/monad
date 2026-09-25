import { describe, it, expect } from 'bun:test';
import { rewind, gotoStage } from './frame-rewind.js';
import { readFrames, appendFrame, setFrameDir } from './frame-journal.js';
import { currentStatus } from './frame-stack.js';
import type { PipelineFrame } from './frame-types.js';
import { emptyBlackboard, type BuildStage } from '../mission-build-coordinator.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';

const NOW = '2026-07-18T01:00:00.000Z';
function fr(seq: number, stage: BuildStage, over: Partial<PipelineFrame> = {}): PipelineFrame {
  return {
    frameId: `m1:${seq}`, missionId: 'm1', seq, stageIndex: seq, stage,
    status: 'done', timestamp: '2026-07-18T00:00:00.000Z', op: 'push',
    inputsSnapshot: emptyBlackboard(), version: 0, ...over,
  };
}
const CHAIN = [fr(0, 'research'), fr(1, 'ground'), fr(2, 'decompose'), fr(3, 'critique')];

describe('frame-rewind — 되감기(셀프힐·순수 계획)', () => {
  it('rewind(1) — top 1개 전으로·이후 supersede', () => {
    const p = rewind(CHAIN, 1, NOW);
    expect(p.ok).toBe(true);
    expect(p.targetStage).toBe('decompose'); // critique(top) 에서 1개 전
    // critique(seq3) 만 supersede + 되감기 기록 1 = 2 프레임 append
    expect(p.framesToAppend).toHaveLength(2);
    expect(p.framesToAppend[0]!.stage).toBe('critique');
    expect(p.framesToAppend[0]!.status).toBe('superseded');
    expect(p.framesToAppend[0]!.supersededBy).toBe(1); // newVersion
    expect(p.framesToAppend[1]!.op).toBe('pop');
  });

  it('gotoStage — 그 stage done 프레임으로·이후 전부 supersede', () => {
    const p = gotoStage(CHAIN, 'ground', NOW);
    expect(p.ok).toBe(true);
    expect(p.targetStage).toBe('ground');
    // decompose(2)·critique(3) supersede + 되감기 = 3 프레임
    expect(p.framesToAppend.filter((f) => f.status === 'superseded').map((f) => f.stage)).toEqual(['decompose', 'critique']);
    expect(p.framesToAppend.at(-1)!.op).toBe('goto');
  });

  it('gotoStage 없는 단계 = ok:false', () => {
    expect(gotoStage([fr(0, 'research')], 'decompose', NOW).ok).toBe(false);
  });

  it('rewind 빈 프레임 = ok:false', () => {
    expect(rewind([], 1, NOW).ok).toBe(false);
  });

  it('저널 통합 — goto 후 currentStatus 가 이후 단계 superseded', () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'rw-')); setFrameDir(dir);
    try {
      for (const f of CHAIN) appendFrame(f);
      const p = gotoStage(readFrames('m1'), 'ground', NOW);
      for (const f of p.framesToAppend) appendFrame(f);
      const st = currentStatus(readFrames('m1'));
      expect(st.decompose).toBe('superseded'); // 마지막 seq 이김
      expect(st.critique).toBe('superseded');
      expect(st.ground).toBe('done'); // 되감기 기록(op goto·done)이 최신
    } finally { setFrameDir(null); fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
