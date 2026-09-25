import { describe, expect, test } from 'bun:test';
import type { ObservatorySubject } from '@/components/observatory/subject-list';
import type { DaemonLogEntry } from '@/lib/daemon-client';
import {
  activityAriaLabel,
  buildActivitySnapshot,
  observatoryHref,
  selectLiveActivity,
  type ShellActivitySnapshot,
} from './activity-snapshot';
import { fetchActivitySnapshot } from './fetch-activity-snapshot';

function subject(overrides: Partial<ObservatorySubject> = {}): ObservatorySubject {
  return {
    id: 'subject:run-1',
    runId: 'run-1',
    origin: 'system',
    screen: { ptyIds: [], liveCount: 0 },
    agent: { names: [], controllers: [] },
    talk: [],
    ...overrides,
  };
}

function progressLog(ptyId: string, runId: string, humanLine: string, id = 1): DaemonLogEntry {
  return {
    id,
    ts: '2026-08-15T00:00:00.000Z',
    level: 'info',
    surface: 'headless',
    category: 'progress',
    event: 'headless.progress-frame',
    data: { ptyId, runId, planId: 'plan-1', seq: 1, humanLine },
  };
}

describe('shell activity snapshot model', () => {
  test('quiet when no live runs exist — empty is not an error', () => {
    expect(buildActivitySnapshot({ status: 'ready', subjects: [] })).toEqual({ kind: 'quiet' });
    expect(buildActivitySnapshot({
      status: 'ready',
      subjects: [subject({ screen: { ptyIds: ['pty-old'], liveCount: 0 } })],
    })).toEqual({ kind: 'quiet' });
  });

  test('error is distinct from quiet', () => {
    expect(buildActivitySnapshot({ status: 'error', message: 'GET /v1/terminals failed (503)' })).toEqual({
      kind: 'error',
      message: 'GET /v1/terminals failed (503)',
    });
    expect(buildActivitySnapshot({ status: 'loading' })).toEqual({ kind: 'loading' });
  });

  test('selects a live run and surfaces origin + progress line', () => {
    const live = subject({
      id: 'subject:self_82122f50',
      runId: 'self_82122f50',
      origin: 'system',
      screen: { ptyIds: ['pty-live'], liveCount: 1 },
    });
    const snapshot = buildActivitySnapshot({
      status: 'ready',
      subjects: [live],
      logs: [progressLog('pty-live', 'self_82122f50', '● orchestrator.ts에서 중단 산출 보존 훅')],
    });
    expect(snapshot).toEqual({
      kind: 'active',
      extraLiveCount: 0,
      run: {
        subjectId: 'subject:self_82122f50',
        runId: 'self_82122f50',
        origin: 'system',
        progressLine: '● orchestrator.ts에서 중단 산출 보존 훅',
        progressStatus: 'complete',
        href: '/observatory#subject%3Aself_82122f50',
      },
    });
    const label = activityAriaLabel(snapshot as Extract<ShellActivitySnapshot, { kind: 'active' }>);
    expect(label).toContain('LIVE self_82122f50');
    expect(label).toContain('origin: system');
    expect(label).toContain('● orchestrator.ts에서 중단 산출 보존 훅');
  });

  test('multiple live runs prefer running progress, then report extras', () => {
    const running = subject({
      id: 'subject:b',
      runId: 'run-b',
      screen: { ptyIds: ['pty-b'], liveCount: 1 },
    });
    const complete = subject({
      id: 'subject:a',
      runId: 'run-a',
      screen: { ptyIds: ['pty-a'], liveCount: 1 },
    });
    const selected = selectLiveActivity(
      [complete, running],
      new Map([
        ['subject:a', { kind: 'progress', ptyId: 'pty-a', line: '● done', status: 'complete', hasMissingFrames: false }],
        ['subject:b', { kind: 'progress', ptyId: 'pty-b', line: '◐ implement', status: 'running', hasMissingFrames: false }],
      ]),
    );
    expect(selected?.run.runId).toBe('run-b');
    expect(selected?.extraLiveCount).toBe(1);
  });

  test('observatory href encodes the subject id', () => {
    expect(observatoryHref('subject:run/1')).toBe('/observatory#subject%3Arun%2F1');
  });
});

describe('fetchActivitySnapshot', () => {
  test('maps empty terminals to quiet', async () => {
    const snapshot = await fetchActivitySnapshot({
      fetchImpl: async () => new Response(JSON.stringify({ subjects: [] }), { status: 200 }),
      listProgressFrames: async () => ({ logs: [] }),
    });
    expect(snapshot).toEqual({ kind: 'quiet' });
  });

  test('maps HTTP failure to error, not quiet', async () => {
    const snapshot = await fetchActivitySnapshot({
      fetchImpl: async () => new Response('no', { status: 503 }),
      listProgressFrames: async () => ({ logs: [] }),
    });
    expect(snapshot.kind).toBe('error');
    if (snapshot.kind === 'error') expect(snapshot.message).toContain('503');
  });

  test('joins progress frames onto a live subject', async () => {
    const live = subject({
      id: 'subject:live',
      runId: 'self_live',
      screen: { ptyIds: ['pty-1'], liveCount: 1 },
    });
    const snapshot = await fetchActivitySnapshot({
      fetchImpl: async () => new Response(JSON.stringify({ subjects: [live] }), { status: 200 }),
      listProgressFrames: async () => ({
        logs: [progressLog('pty-1', 'self_live', '◐ implement')],
      }),
    });
    expect(snapshot.kind).toBe('active');
    if (snapshot.kind === 'active') {
      expect(snapshot.run.runId).toBe('self_live');
      expect(snapshot.run.progressStatus).toBe('running');
      expect(snapshot.run.progressLine).toBe('◐ implement');
    }
  });
});
