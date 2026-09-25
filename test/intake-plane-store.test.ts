import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RawIntakeRecord } from '../src/intake-plane/index.js';
import { createIntakeStore } from '../src/intake-plane/index.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'intake-plane-'));
  dirs.push(dir);
  return dir;
}

function makeRaw(overrides: Partial<RawIntakeRecord> = {}): RawIntakeRecord {
  return {
    intakeId: overrides.intakeId ?? 'intake-1',
    source: overrides.source ?? 'tui-scratch',
    rawText: overrides.rawText ?? '- check issue\n- compare repos',
    attachments: overrides.attachments ?? [],
    transcriptSource: overrides.transcriptSource,
    // Default receivedAt = "now" so archive filenames
    // (intake-<YYYYMMDD>.jsonl + intake-snapshots-<YYYYMMDD>.jsonl)
    // collapse onto a single day. Previous hardcoded 2026-04-30
    // split files across two dates once the wall clock crossed
    // that day, causing `expect(entries).toHaveLength(2)` to flip
    // to 4 on or after 2026-05-01.
    receivedAt: overrides.receivedAt ?? new Date().toISOString(),
    actor: overrides.actor,
    channelContext: overrides.channelContext,
  };
}

beforeEach(() => {
  dirs.length = 0;
});

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe('createIntakeStore', () => {
  test('capture stores a raw session and emits a captured event', () => {
    const store = createIntakeStore({ archiveDir: null });
    const session = store.capture(makeRaw());
    expect(session.state).toBe('captured');
    expect(session.raw.rawText).toContain('compare repos');
    expect(store.getSession('intake-1')?.state).toBe('captured');
    const events = store.listEvents({ intakeId: 'intake-1' });
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('captured');
  });

  test('setState enforces legal transitions', () => {
    const store = createIntakeStore({ archiveDir: null });
    store.capture(makeRaw());
    store.setState('intake-1', 'normalized');
    const updated = store.setState('intake-1', 'drafted');
    expect(updated.state).toBe('drafted');
    expect(() => store.setState('intake-1', 'applied')).toThrow(
      /Illegal intake state transition/,
    );
  });

  test('saveDraft infers clarifying when open questions exist', () => {
    const store = createIntakeStore({ archiveDir: null });
    store.capture(makeRaw());
    store.setState('intake-1', 'normalized');
    const session = store.saveDraft('intake-1', {
      intakeId: 'intake-1',
      title: 'Capture platform ideas',
      summary: 'Mixed notes',
      items: [
        {
          id: 'i1',
          kind: 'research',
          text: 'inspect repos',
          links: ['https://example.com'],
          needsClarification: true,
          proposedAction: 'ask-user',
        },
      ],
      openQuestions: [
        {
          id: 'q1',
          scope: 'item',
          itemId: 'i1',
          question: 'Research only?',
          reason: 'execution mode missing',
        },
      ],
      suggestedMode: 'mixed',
      confidence: 0.62,
    });
    expect(session.state).toBe('clarifying');
    expect(session.draft?.openQuestions).toHaveLength(1);
  });

  test('saveDraft can move directly to review-ready', () => {
    const store = createIntakeStore({ archiveDir: null });
    store.capture(makeRaw());
    const session = store.saveDraft('intake-1', {
      intakeId: 'intake-1',
      title: 'Quick bug capture',
      summary: 'One actionable task',
      items: [
        {
          id: 'i1',
          kind: 'bug',
          text: 'fix image preview',
          links: [],
          needsClarification: false,
          proposedAction: 'task-create',
        },
      ],
      openQuestions: [],
      suggestedMode: 'task-creation',
      confidence: 0.94,
    });
    expect(session.state).toBe('review-ready');
  });

  test('saveDecision preserves current state but records metadata', () => {
    const store = createIntakeStore({ archiveDir: null });
    store.capture(makeRaw());
    store.saveDraft('intake-1', {
      intakeId: 'intake-1',
      title: 'Quick bug capture',
      summary: 'One actionable task',
      items: [
        {
          id: 'i1',
          kind: 'bug',
          text: 'fix image preview',
          links: [],
          needsClarification: false,
          proposedAction: 'task-create',
        },
      ],
      openQuestions: [],
      suggestedMode: 'task-creation',
      confidence: 0.94,
    });
    const session = store.saveDecision('intake-1', {
      intakeId: 'intake-1',
      mode: 'apply-now',
      approvedItemIds: ['i1'],
      deferredItemIds: [],
      clarifiedAnswers: {},
    });
    expect(session.state).toBe('review-ready');
    expect(session.decision?.mode).toBe('apply-now');
  });

  test('saveProposal stores apply token and advances to proposed', () => {
    const store = createIntakeStore({ archiveDir: null });
    store.capture(makeRaw());
    store.saveDraft('intake-1', {
      intakeId: 'intake-1',
      title: 'Quick bug capture',
      summary: 'One actionable task',
      items: [],
      openQuestions: [],
      suggestedMode: 'task-creation',
      confidence: 0.94,
    });
    const session = store.saveProposal(
      'intake-1',
      {
        intakeId: 'intake-1',
        objective: 'Fix image preview issue',
        scheduleText: 'tomorrow 9am',
        contextNotes: ['reported from scratch pane'],
      },
      { applyToken: 'tx-abc123' },
    );
    expect(session.state).toBe('proposed');
    expect(session.applyToken).toBe('tx-abc123');
    expect(session.proposal?.scheduleText).toBe('tomorrow 9am');
  });

  test('archive writes JSONL events when archiveDir is configured', () => {
    const archiveDir = tempDir();
    const store = createIntakeStore({ archiveDir });
    store.capture(makeRaw({ intakeId: 'intake-archive' }));
    store.setState('intake-archive', 'normalized');
    store.archive('intake-archive');

    const entries = readdirSync(archiveDir);
    expect(entries).toHaveLength(2);
    const eventFile = join(
      archiveDir,
      entries.find((entry) => entry.startsWith('intake-') && !entry.startsWith('intake-snapshots-'))!,
    );
    const snapshotFile = join(archiveDir, entries.find((entry) => entry.startsWith('intake-snapshots-'))!);
    expect(existsSync(eventFile)).toBe(true);
    expect(existsSync(snapshotFile)).toBe(true);
    const eventLines = readFileSync(eventFile, 'utf8').trim().split('\n');
    expect(eventLines.length).toBe(3);
    expect(eventLines[0]).toContain('"kind":"captured"');
    expect(eventLines[2]).toContain('"kind":"archived"');
    const snapshotLines = readFileSync(snapshotFile, 'utf8').trim().split('\n');
    expect(snapshotLines.length).toBe(3);
    expect(snapshotLines[0]).toContain('"kind":"session-snapshot"');
    expect(snapshotLines[2]).toContain('"state":"archived"');
  });

  test('replay restores the latest session snapshots from disk', () => {
    const archiveDir = tempDir();
    const store1 = createIntakeStore({ archiveDir });
    store1.capture(makeRaw({ intakeId: 'intake-replay' }));
    store1.setState('intake-replay', 'normalized');
    store1.saveDraft('intake-replay', {
      intakeId: 'intake-replay',
      title: 'Replay me',
      summary: 'One actionable task',
      items: [
        {
          id: 'i1',
          kind: 'bug',
          text: 'fix image preview',
          links: [],
          needsClarification: false,
          proposedAction: 'task-create',
        },
      ],
      openQuestions: [],
      suggestedMode: 'task-creation',
      confidence: 0.94,
    });

    const store2 = createIntakeStore({ archiveDir });
    expect(store2.listSessions()).toHaveLength(0);
    expect(store2.replay()).toBeGreaterThan(0);
    const restored = store2.getSession('intake-replay');
    expect(restored?.state).toBe('review-ready');
    expect(restored?.draft?.title).toBe('Replay me');
  });

  test('replayOnInit restores snapshots and skips corrupt lines', () => {
    const archiveDir = tempDir();
    const store1 = createIntakeStore({ archiveDir });
    store1.capture(makeRaw({ intakeId: 'intake-replay-init' }));
    store1.archive('intake-replay-init');
    const snapshotFile = join(
      archiveDir,
      readdirSync(archiveDir).find((entry) => entry.startsWith('intake-snapshots-'))!,
    );
    const original = readFileSync(snapshotFile, 'utf8');
    rmSync(snapshotFile);
    const corrupted = `${original}not-json\n{"kind":"session-snapshot","session":{"oops":true}}\n`;
    writeFileSync(snapshotFile, corrupted, 'utf8');

    const store2 = createIntakeStore({ archiveDir, replayOnInit: true });
    const restored = store2.getSession('intake-replay-init');
    expect(restored?.state).toBe('archived');
  });

  test('returned sessions are defensive copies', () => {
    const store = createIntakeStore({ archiveDir: null });
    const session = store.capture(makeRaw());
    session.raw.rawText = 'mutated';
    const loaded = store.getSession('intake-1');
    expect(loaded?.raw.rawText).toBe('- check issue\n- compare repos');
  });
});
