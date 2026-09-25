// P4 — 빌드 re-drive 계획(순수) 테스트
import { describe, expect, it } from 'bun:test';
import { planBuildRerun } from './build-rerun.js';
import { BUILD_STAGES, type Blackboard, type BuildStage } from '../mission-build-coordinator.js';
import type { PipelineFrame } from './frame-types.js';

const bb = (tag: string): Blackboard => ({ results: {}, decisions: { note: tag } as never });
const frame = (stage: BuildStage, seq: number, over: Partial<PipelineFrame> = {}): PipelineFrame => ({
  frameId: `m:${seq}`, missionId: 'm', seq, stageIndex: BUILD_STAGES.indexOf(stage), stage,
  status: 'done', timestamp: `2026-07-20T10:0${seq}:00Z`, op: 'push', inputsSnapshot: bb(`entry-${stage}`), version: 0, ...over,
});

describe('planBuildRerun', () => {
  it('fromStage 의 inputsSnapshot 을 seed, fromStage..끝을 stages 로', () => {
    const frames = BUILD_STAGES.map((s, i) => frame(s, i));
    const p = planBuildRerun(frames, 'decompose');
    expect(p.ok).toBe(true);
    expect((p.seed.decisions as unknown as { note: string }).note).toBe('entry-decompose');
    expect(p.stages[0]).toBe('decompose');
    expect(p.stages[p.stages.length - 1]).toBe(BUILD_STAGES[BUILD_STAGES.length - 1]);
    expect(p.stages).not.toContain('research'); // 선행 단계는 재실행 안 함
  });

  it('알 수 없는 단계 → ok:false', () => {
    expect(planBuildRerun([], 'nope' as BuildStage).ok).toBe(false);
  });

  it('그 단계 프레임 없음 → ok:false', () => {
    const frames = [frame('research', 0)];
    const p = planBuildRerun(frames, 'decompose');
    expect(p.ok).toBe(false);
    expect(p.reason).toContain('활성 프레임 없음');
  });

  it('superseded 프레임은 target 제외', () => {
    const frames = [frame('decompose', 0, { supersededBy: 5 }), frame('decompose', 6, { inputsSnapshot: bb('entry-fresh') })];
    const p = planBuildRerun(frames, 'decompose');
    expect(p.ok).toBe(true);
    expect((p.seed.decisions as unknown as { note: string }).note).toBe('entry-fresh'); // 활성(비-superseded) 최신
  });

  it('최신 세대만(H6) — 옛 세대 프레임 무시', () => {
    const frames = [
      frame('decompose', 0, { generation: 0, inputsSnapshot: bb('gen0') }),
      frame('decompose', 9, { generation: 1, inputsSnapshot: bb('gen1') }),
    ];
    const p = planBuildRerun(frames, 'decompose');
    expect((p.seed.decisions as unknown as { note: string }).note).toBe('gen1'); // 최신 세대
  });
});
