// ── V2 (Phase 2 Bundle 2) — voice-orchestrator tests ──

import { describe, expect, test } from 'bun:test';
import {
  createVoiceOrchestrator,
  type VoiceOrchestrationGoal,
  type VoiceOrchestrationSubagentHandle,
} from '../../src/voice/voice-orchestrator';

function fakeHandle(id = 's1'): VoiceOrchestrationSubagentHandle {
  return {
    id,
    cancel: async () => {},
  };
}

describe('createVoiceOrchestrator — happy path', () => {
  test('classify → spawn → await → speak', async () => {
    const spoken: string[] = [];
    const orch = createVoiceOrchestrator({
      classifyVoiceGoal: async () => ({ kind: 'coding', transcript: 't' }),
      spawnSubagent: async () => fakeHandle('a1'),
      awaitSubagent: async () => ({ ok: true, summary: 'PR opened' }),
      speak: async (s) => { spoken.push(s); },
    });
    const out = await orch.run({ transcript: 'fix the build' });
    expect(out.outcome).toBe('spoken');
    expect(out.subagentId).toBe('a1');
    expect(out.subagentSummary).toBe('PR opened');
    expect(spoken[0]).toContain('coding');
    expect(spoken[0]).toContain('완료');
  });
});

describe('createVoiceOrchestrator — failure paths', () => {
  test('classifier returns null → classify-failed', async () => {
    const spoken: string[] = [];
    const orch = createVoiceOrchestrator({
      classifyVoiceGoal: async () => null,
      spawnSubagent: async () => fakeHandle(),
      awaitSubagent: async () => ({ ok: true, summary: '' }),
      speak: async (s) => { spoken.push(s); },
    });
    const out = await orch.run({ transcript: '뭐 하지' });
    expect(out.outcome).toBe('classify-failed');
    expect(spoken[0]).toContain('의도');
  });

  test('classifier exceeds budget → classify-failed', async () => {
    const orch = createVoiceOrchestrator({
      classifyVoiceGoal: () => new Promise((r) => setTimeout(() => r({ kind: 'coding', transcript: '' }), 200)),
      spawnSubagent: async () => fakeHandle(),
      awaitSubagent: async () => ({ ok: true, summary: '' }),
      speak: async () => {},
      classifyBudgetMs: 50,
    });
    const out = await orch.run({ transcript: 't' });
    expect(out.outcome).toBe('classify-failed');
  });

  test('spawn returns null → spawn-failed', async () => {
    const orch = createVoiceOrchestrator({
      classifyVoiceGoal: async () => ({ kind: 'coding', transcript: 't' }),
      spawnSubagent: async () => null,
      awaitSubagent: async () => ({ ok: true, summary: '' }),
      speak: async () => {},
    });
    const out = await orch.run({ transcript: 't' });
    expect(out.outcome).toBe('spawn-failed');
    expect(out.goal!.kind).toBe('coding');
  });

  test('spawn throws → spawn-failed (graceful)', async () => {
    const orch = createVoiceOrchestrator({
      classifyVoiceGoal: async () => ({ kind: 'coding', transcript: 't' }),
      spawnSubagent: async () => { throw new Error('no capacity'); },
      awaitSubagent: async () => ({ ok: true, summary: '' }),
      speak: async () => {},
    });
    const out = await orch.run({ transcript: 't' });
    expect(out.outcome).toBe('spawn-failed');
  });

  test('await returns null → await-timeout (cancels handle)', async () => {
    let cancelled = false;
    const orch = createVoiceOrchestrator({
      classifyVoiceGoal: async () => ({ kind: 'coding', transcript: 't' }),
      spawnSubagent: async () => ({
        id: 'a1',
        cancel: async () => { cancelled = true; },
      }),
      awaitSubagent: () => new Promise((r) => setTimeout(() => r({ ok: true, summary: 'late' }), 200)),
      speak: async () => {},
      awaitBudgetMs: 50,
    });
    const out = await orch.run({ transcript: 't' });
    expect(out.outcome).toBe('await-timeout');
    expect(cancelled).toBe(true);
    expect(out.subagentId).toBe('a1');
  });

  test('subagent failure → subagent-failed with summary', async () => {
    const spoken: string[] = [];
    const orch = createVoiceOrchestrator({
      classifyVoiceGoal: async () => ({ kind: 'coding', transcript: 't' }),
      spawnSubagent: async () => fakeHandle('a1'),
      awaitSubagent: async () => ({ ok: false, summary: 'merge conflict' }),
      speak: async (s) => { spoken.push(s); },
    });
    const out = await orch.run({ transcript: 't' });
    expect(out.outcome).toBe('subagent-failed');
    expect(out.subagentSummary).toBe('merge conflict');
    expect(spoken[0]).toContain('실패');
    expect(spoken[0]).toContain('merge conflict');
  });

  test('speak throws → tts-failed (utterance preserved)', async () => {
    const orch = createVoiceOrchestrator({
      classifyVoiceGoal: async () => ({ kind: 'research', transcript: 't' }),
      spawnSubagent: async () => fakeHandle('a1'),
      awaitSubagent: async () => ({ ok: true, summary: 'done' }),
      speak: async () => { throw new Error('audio dead'); },
    });
    const out = await orch.run({ transcript: 't' });
    expect(out.outcome).toBe('tts-failed');
    expect(out.utterance).toContain('research');
  });
});

describe('createVoiceOrchestrator — composer override', () => {
  test('custom composeUtterance honored', async () => {
    const spoken: string[] = [];
    const orch = createVoiceOrchestrator({
      classifyVoiceGoal: async () => ({ kind: 'coding', transcript: 't' }),
      spawnSubagent: async () => fakeHandle(),
      awaitSubagent: async () => ({ ok: true, summary: 's' }),
      speak: async (s) => { spoken.push(s); },
      composeUtterance: ({ goal }) => `Override: ${goal.kind}`,
    });
    await orch.run({ transcript: 't' });
    expect(spoken[0]).toBe('Override: coding');
  });
});
