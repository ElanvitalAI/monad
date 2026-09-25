import { afterEach, describe, expect, it } from 'bun:test';
import { createIntakeStore } from '../src/intake-plane/store.js';
import {
  __intakeVoiceCommandTestUtils,
  maybeHandleSpokenVoiceIntake,
} from '../src/intake-plane/adapters/voice-command.js';
import { TaskDispatcher } from '../src/task-orchestrator/dispatcher.ts';
import { TaskEventBus } from '../src/task-orchestrator/events.ts';
import { TaskGenerator, type DecomposeCallable } from '../src/task-orchestrator/generator.ts';
import { TaskGraph } from '../src/task-orchestrator/graph.ts';
import {
  clearPendingDecomposeForTest,
  resetToxRuntimeDepsForTest,
  setToxRuntimeDeps,
} from '../src/task-orchestrator/runtime-deps.ts';
import { SurfaceRegistry } from '../src/task-orchestrator/surface-registry.ts';
import type { TaskSurface } from '../src/task-orchestrator/types.ts';

const surfaceLlm: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

function makeGenerator(proposal: unknown): TaskGenerator {
  return new TaskGenerator({
    callable: (async () => ({ text: JSON.stringify(proposal) })) as DecomposeCallable,
  });
}

afterEach(() => {
  clearPendingDecomposeForTest();
  resetToxRuntimeDepsForTest();
});

describe('voice intake command parser', () => {
  it('ignores ordinary transcripts', () => {
    expect(__intakeVoiceCommandTestUtils.parseSpokenIntakeTranscript('compare two repos')).toBeNull();
  });

  it('normalizes spoken duration phrases into scheduler syntax', () => {
    expect(__intakeVoiceCommandTestUtils.normalizeDurationText('30m')).toBe('30m');
    expect(__intakeVoiceCommandTestUtils.normalizeDurationText('30 minutes')).toBe('30m');
    expect(__intakeVoiceCommandTestUtils.normalizeDurationText('2 hours')).toBe('2h');
    expect(__intakeVoiceCommandTestUtils.normalizeDurationText('1 day')).toBe('1d');
  });

  it('parses review/apply/backlog/schedule variants', () => {
    expect(__intakeVoiceCommandTestUtils.parseSpokenIntakeTranscript('intake compare two repos')).toEqual({
      action: 'capture',
      mode: 'review',
      body: 'compare two repos',
    });
    expect(__intakeVoiceCommandTestUtils.parseSpokenIntakeTranscript('intake now compare two repos')).toEqual({
      action: 'capture',
      mode: 'apply-now',
      body: 'compare two repos',
    });
    expect(__intakeVoiceCommandTestUtils.parseSpokenIntakeTranscript('intake backlog compare two repos')).toEqual({
      action: 'capture',
      mode: 'backlog-only',
      body: 'compare two repos',
    });
    expect(__intakeVoiceCommandTestUtils.parseSpokenIntakeTranscript('intake when tomorrow morning: compare two repos')).toEqual({
      action: 'capture',
      mode: 'schedule-followup',
      scheduleText: 'tomorrow morning',
      body: 'compare two repos',
    });
    expect(__intakeVoiceCommandTestUtils.parseSpokenIntakeTranscript('intake in 30 minutes compare two repos')).toEqual({
      action: 'capture',
      mode: 'schedule-followup',
      scheduleText: '30m',
      body: 'compare two repos',
    });
    expect(__intakeVoiceCommandTestUtils.parseSpokenIntakeTranscript('intake remind me in 2 hours to compare two repos')).toEqual({
      action: 'capture',
      mode: 'schedule-followup',
      scheduleText: '2h',
      body: 'compare two repos',
    });
    expect(__intakeVoiceCommandTestUtils.parseSpokenIntakeTranscript('intake answer intake-voice-review keep it in backlog')).toEqual({
      action: 'answer',
      intakeId: 'intake-voice-review',
      answer: 'keep it in backlog',
    });
    expect(__intakeVoiceCommandTestUtils.parseSpokenIntakeTranscript('intake answer keep it in backlog for intake-voice-review')).toEqual({
      action: 'answer',
      intakeId: 'intake-voice-review',
      answer: 'keep it in backlog',
    });
    expect(__intakeVoiceCommandTestUtils.parseSpokenIntakeTranscript('intake answer keep it in backlog')).toEqual({
      action: 'answer',
      answer: 'keep it in backlog',
    });
    expect(__intakeVoiceCommandTestUtils.parseSpokenIntakeTranscript('intake apply')).toEqual({
      action: 'session-command',
      command: 'apply',
      intakeId: undefined,
    });
    expect(__intakeVoiceCommandTestUtils.parseSpokenIntakeTranscript('intake schedule tomorrow morning')).toEqual({
      action: 'session-command',
      command: 'schedule',
      scheduleText: 'tomorrow morning',
      intakeId: undefined,
    });
    expect(__intakeVoiceCommandTestUtils.parseSpokenIntakeTranscript('intake when 30m for intake-voice-review')).toEqual({
      action: 'session-command',
      command: 'schedule',
      scheduleText: '30m',
      intakeId: 'intake-voice-review',
    });
    expect(__intakeVoiceCommandTestUtils.parseSpokenIntakeTranscript('intake backlog intake-voice-review')).toEqual({
      action: 'session-command',
      command: 'backlog',
      intakeId: 'intake-voice-review',
    });
  });

  it('maps spoken intake follow-ups into input intents', () => {
    expect(__intakeVoiceCommandTestUtils.resolveSpokenVoiceInputIntent('intake answer keep it in backlog')).toEqual({
      kind: 'answer-clarify',
      source: {
        kind: 'voice',
        channel: 'dashboard',
        surface: 'dashboard-voice-chat',
        mode: 'multi-turn',
        transcriptSource: 'voice',
      },
      intakeId: undefined,
      answer: 'keep it in backlog',
    });
    expect(__intakeVoiceCommandTestUtils.resolveSpokenVoiceInputIntent('intake apply')).toEqual({
      kind: 'control-turn',
      source: {
        kind: 'voice',
        channel: 'dashboard',
        surface: 'dashboard-voice-chat',
        mode: 'multi-turn',
        transcriptSource: 'voice',
      },
      command: 'intake-apply',
      intakeId: undefined,
      scheduleText: undefined,
    });
    expect(__intakeVoiceCommandTestUtils.resolveSpokenVoiceInputIntent('intake compare two repos')).toEqual({
      kind: 'control-turn',
      source: {
        kind: 'voice',
        channel: 'dashboard',
        surface: 'dashboard-voice-chat',
        mode: 'multi-turn',
        transcriptSource: 'voice',
      },
      command: 'intake-capture',
      text: 'compare two repos',
      mode: 'review',
      scheduleText: undefined,
    });
  });
});

describe('maybeHandleSpokenVoiceIntake', () => {
  it('captures review-ready intake from a spoken command', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const reply = await maybeHandleSpokenVoiceIntake({
      transcript: 'intake compare two repos',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-voice-review',
    });
    expect(reply).toContain('I captured that as intake intake-voice-review.');
    expect(reply).toContain("It's ready for review.");
    expect(store.getSession('intake-voice-review')?.raw.source).toBe('voice');
    expect(store.getSession('intake-voice-review')?.raw.inputSourceKind).toBe('voice');
    expect(store.getSession('intake-voice-review')?.raw.rawText).toBe('compare two repos');
  });

  it('applies tasks immediately for intake now', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const graph = new TaskGraph();
    const dispatcher = new TaskDispatcher({
      graph,
      registry: new SurfaceRegistry(),
      bus: new TaskEventBus(),
    });
    setToxRuntimeDeps({
      getGraph: () => graph,
      getDispatcher: () => dispatcher,
      getGenerator: () => makeGenerator({
        rationale: 'split work',
        tasks: [{ index: 0, title: 'Investigate', surface: surfaceLlm }],
      }),
    });
    const reply = await maybeHandleSpokenVoiceIntake({
      transcript: 'intake now compare two repos',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-voice-now',
    });
    expect(reply).toContain('turned into tasks');
    expect(store.getSession('intake-voice-now')?.state).toBe('applied');
  });

  it('marks backlog-only spoken intake clearly', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const reply = await maybeHandleSpokenVoiceIntake({
      transcript: 'intake backlog compare two repos',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-voice-backlog',
    });
    expect(reply).toContain('marked for the backlog');
    expect(store.getSession('intake-voice-backlog')?.decision?.mode).toBe('backlog-only');
  });

  it('schedules spoken follow-up with a colon separator', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const graph = new TaskGraph();
    const dispatcher = new TaskDispatcher({
      graph,
      registry: new SurfaceRegistry(),
      bus: new TaskEventBus(),
    });
    setToxRuntimeDeps({
      getGraph: () => graph,
      getDispatcher: () => dispatcher,
    });
    const reply = await maybeHandleSpokenVoiceIntake({
      transcript: 'intake when 30m: compare two repos',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-voice-scheduled',
    });
    expect(reply).toContain('scheduled for follow-up');
    expect(store.getSession('intake-voice-scheduled')?.state).toBe('scheduled');
  });

  it('schedules spoken follow-up from natural duration phrasing', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const graph = new TaskGraph();
    const dispatcher = new TaskDispatcher({
      graph,
      registry: new SurfaceRegistry(),
      bus: new TaskEventBus(),
    });
    setToxRuntimeDeps({
      getGraph: () => graph,
      getDispatcher: () => dispatcher,
    });
    const reply = await maybeHandleSpokenVoiceIntake({
      transcript: 'intake remind me in 2 hours to compare two repos',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-voice-natural-schedule',
    });
    expect(reply).toContain('scheduled for follow-up');
    expect(store.getSession('intake-voice-natural-schedule')?.state).toBe('scheduled');
  });

  it('resolves the first clarify question through a spoken answer command', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await maybeHandleSpokenVoiceIntake({
      transcript: 'intake ====',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-voice-clarify',
    });
    const reply = await maybeHandleSpokenVoiceIntake({
      transcript: 'intake answer intake-voice-clarify keep it in backlog',
      store,
    });
    expect(reply).toContain('I updated intake intake-voice-clarify.');
    expect(reply).toContain('marked for the backlog');
    expect(store.getSession('intake-voice-clarify')?.decision?.mode).toBe('backlog-only');
  });

  it('resolves the latest clarify question through a spoken answer command without ids', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await maybeHandleSpokenVoiceIntake({
      transcript: 'intake ====',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-voice-latest',
    });
    const reply = await maybeHandleSpokenVoiceIntake({
      transcript: 'intake answer keep it in backlog',
      store,
    });
    expect(reply).toContain('I updated intake intake-voice-latest.');
    expect(reply).toContain('marked for the backlog');
    expect(store.getSession('intake-voice-latest')?.decision?.mode).toBe('backlog-only');
  });

  it('applies the latest intake through a spoken follow-up command', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const graph = new TaskGraph();
    const dispatcher = new TaskDispatcher({
      graph,
      registry: new SurfaceRegistry(),
      bus: new TaskEventBus(),
    });
    setToxRuntimeDeps({
      getGraph: () => graph,
      getDispatcher: () => dispatcher,
      getGenerator: () => makeGenerator({
        rationale: 'split work',
        tasks: [{ index: 0, title: 'Investigate', surface: surfaceLlm }],
      }),
    });
    await maybeHandleSpokenVoiceIntake({
      transcript: 'intake compare two repos',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-voice-apply',
    });
    const reply = await maybeHandleSpokenVoiceIntake({
      transcript: 'intake apply',
      store,
    });
    expect(reply).toContain('I updated intake intake-voice-apply.');
    expect(reply).toContain('TaskDecomposeApply');
    expect(store.getSession('intake-voice-apply')?.state).toBe('applied');
  });

  it('marks the latest intake as backlog through a spoken follow-up command', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await maybeHandleSpokenVoiceIntake({
      transcript: 'intake compare two repos',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-voice-backlog-latest',
    });
    const reply = await maybeHandleSpokenVoiceIntake({
      transcript: 'intake backlog',
      store,
    });
    expect(reply).toContain('I updated intake intake-voice-backlog-latest.');
    expect(reply).toContain('backlog-only');
    expect(store.getSession('intake-voice-backlog-latest')?.decision?.mode).toBe('backlog-only');
  });

  it('schedules the latest intake through a spoken follow-up command', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await maybeHandleSpokenVoiceIntake({
      transcript: 'intake compare two repos',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-voice-schedule-latest',
    });
    const reply = await maybeHandleSpokenVoiceIntake({
      transcript: 'intake schedule tomorrow morning',
      store,
    });
    expect(reply).toContain('I updated intake intake-voice-schedule-latest.');
    expect(reply).toContain('scheduled as "tomorrow morning"');
    expect(store.getSession('intake-voice-schedule-latest')?.decision?.mode).toBe('schedule-followup');
  });
});
