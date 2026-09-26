// ── escalate 표면화 테스트 (PR2 · 2026-07-13) ─────────────────────────────
// [SUSPECT] 영속/복원 · 페이즈 콜백 escalate 파싱 · escalate 액션 no-spawn 분기(보안경계/미검출).
// spawn 분기(신호 있음→R3 Opus→수리미션)는 실 LLM/network 라 PR1 seam 테스트로 커버(여기선 제외).

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderSuspectNotes, parseSuspectNotes, detectContradictions } from './contradiction-detector.js';
import { buildPhaseCallbackData, parsePhaseCallbackData } from './mission-notify.js';

describe('[SUSPECT] 영속/복원 (renderSuspectNotes / parseSuspectNotes)', () => {
  it('실 모순 신호 라운드트립 — kind/detail 보존', () => {
    const signals = detectContradictions({ changedFiles: ['a.ts', 'b.ts'], diffBody: '' });
    expect(signals.length).toBe(1);
    const notes = renderSuspectNotes(signals);
    expect(notes[0]!.startsWith('[SUSPECT:files-touched-but-empty-diff]')).toBe(true);
    const back = parseSuspectNotes(notes);
    expect(back.length).toBe(1);
    expect(back[0]!.kind).toBe('files-touched-but-empty-diff');
    expect(back[0]!.systemSuspect).toBe(true);
    expect(back[0]!.detail).toBe(signals[0]!.detail);
  });

  it('알 수 없는 kind·비-SUSPECT 노트는 skip', () => {
    const back = parseSuspectNotes(['[SUSPECT:bogus-kind] x', '[DIAGNOSIS] 일반 노트', '[SUSPECT:diff-body-absent] 본문 미전달']);
    expect(back.length).toBe(1);
    expect(back[0]!.kind).toBe('diff-body-absent');
  });
});

describe('페이즈 콜백 escalate 파싱', () => {
  it('buildPhaseCallbackData/parsePhaseCallbackData escalate 라운드트립', () => {
    const data = buildPhaseCallbackData('task:abc123', 'escalate');
    expect(data).toBe('apm-phase:abc123:escalate');
    const p = parsePhaseCallbackData(data);
    expect(p?.action).toBe('escalate');
  });
});

describe('escalate 액션 — no-spawn 분기', () => {
  let dir: string;
  let prevTasksDir: string | undefined;
  let prevNodeEnv: string | undefined;

  beforeAll(() => {
    prevTasksDir = process.env.ELANOUS_TASKS_DIR;
    prevNodeEnv = process.env.NODE_ENV;
    dir = mkdtempSync(join(tmpdir(), 'elanous-escalate-'));
    process.env.ELANOUS_TASKS_DIR = dir;      // 액션 내부 new TaskStore() 와 테스트가 같은 격리 DB 공유
    process.env.NODE_ENV = 'test';
  });
  afterAll(() => {
    if (prevTasksDir === undefined) delete process.env.ELANOUS_TASKS_DIR; else process.env.ELANOUS_TASKS_DIR = prevTasksDir;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNodeEnv;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  async function makeMissionWithPhase(notes: string[]): Promise<{ missionId: string }> {
    const { TaskStore } = await import('../task-orchestrator/store.js');
    const { createMission } = await import('./mission-registry.js');
    const { createTask } = await import('../task-orchestrator/types.js');
    const store = new TaskStore();
    try {
      const m = createMission(store, { goal: '셀프힐 테스트 미션', source: 'human-intent', triage: { executionModel: 'task', tier: 'heavy', engine: 'tox' } });
      const t = createTask({
        title: '급락 관측 어댑터', description: 'x',
        surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: 'x' },
        goalSlug: m.id, dependsOn: [], status: 'failed',
        generatedBy: { kind: 'user', actorId: 'test' },
      }, { allowUncheckedUrgent: true, now: 1000 });
      store.saveTask({ ...t, notes });
      return { missionId: m.id };
    } finally { store.close(); }
  }

  it('[SUSPECT] 없음 → spawned=false (자동 수리 미대상)', async () => {
    const { missionId } = await makeMissionWithPhase(['[DIAGNOSIS:budget-exhausted] 실패 근본원인: x 권장: rebuild(low)']);
    const { dispatchAutopilotMissions } = await import('./mission-tool.js');
    const r = await dispatchAutopilotMissions({ action: 'escalate', id: missionId, phase: '0' }) as { ok?: boolean; spawned?: boolean; boundary?: string };
    expect(r.ok).toBe(true);
    expect(r.spawned).toBe(false);
    expect(r.boundary).toBeUndefined();
  });

  it('보안 경계(provenance) escalate → spawned=false, boundary=provenance', async () => {
    const { missionId } = await makeMissionWithPhase(['[DIAGNOSIS:provenance] 문서 명령 거부 근본원인: 신뢰 경계 권장: escalate(high)']);
    const { dispatchAutopilotMissions } = await import('./mission-tool.js');
    const r = await dispatchAutopilotMissions({ action: 'escalate', id: missionId, phase: '0' }) as { ok?: boolean; spawned?: boolean; boundary?: string };
    expect(r.ok).toBe(true);
    expect(r.spawned).toBe(false);
    expect(r.boundary).toBe('provenance');
  });

  it('phase 미지정 → error', async () => {
    const { dispatchAutopilotMissions } = await import('./mission-tool.js');
    const r = await dispatchAutopilotMissions({ action: 'escalate', id: 'apm_x' }) as { error?: string };
    expect(r.error).toBeTruthy();
  });
});
