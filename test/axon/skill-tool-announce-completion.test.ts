// AXON P5 — AnnounceCompletion tool + AnnouncementStore singleton tests.

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  dispatchAnnounceCompletion,
} from '../../src/skills/tools/announce-completion.js';
import { announcementStore } from '../../src/axon/announcement-store.js';
import { evaluateTermination } from '../../src/axon/termination-detector.js';

beforeEach(() => {
  announcementStore.__clear();
});

describe('dispatchAnnounceCompletion', () => {
  it('records the announcement and returns the full record', async () => {
    const out = await dispatchAnnounceCompletion({
      summary: 'All six phases landed.',
      outcome: 'success',
      nextSteps: ['update ROADMAP', 'tag the commit'],
    });
    expect(out.ok).toBe(true);
    expect(out.record.summary).toBe('All six phases landed.');
    expect(out.record.outcome).toBe('success');
    expect(out.record.nextSteps).toEqual(['update ROADMAP', 'tag the commit']);
    expect(out.announcedAt).toBeGreaterThan(0);
  });

  it('surfaces the record via AnnouncementStore.getLast', async () => {
    await dispatchAnnounceCompletion({ summary: 's', outcome: 'partial' });
    const last = announcementStore.getLast();
    expect(last?.outcome).toBe('partial');
  });

  it('hasAnnounced toggles after one call', async () => {
    expect(announcementStore.hasAnnounced()).toBe(false);
    await dispatchAnnounceCompletion({ summary: 's', outcome: 'failed' });
    expect(announcementStore.hasAnnounced()).toBe(true);
  });

  it('rejects a missing summary', async () => {
    await expect(
      // @ts-expect-error — runtime validation
      dispatchAnnounceCompletion({ outcome: 'success' }),
    ).rejects.toThrow(/summary is required/);
  });

  it('rejects an unknown outcome', async () => {
    await expect(
      // @ts-expect-error — runtime validation
      dispatchAnnounceCompletion({ summary: 's', outcome: 'wat' }),
    ).rejects.toThrow(/outcome must be one of/);
  });

  it('filters out empty / non-string nextSteps entries', async () => {
    const out = await dispatchAnnounceCompletion({
      summary: 's',
      outcome: 'success',
      // @ts-expect-error — intentionally mixed array
      nextSteps: ['valid', '', 0, null, 'also valid'],
    });
    expect(out.record.nextSteps).toEqual(['valid', 'also valid']);
  });

  it('links through to the termination detector — factor 7 flips', async () => {
    // Before announcement — detector stays at "continue".
    const before = evaluateTermination({});
    expect(before.shouldTerminate).toBe(false);

    await dispatchAnnounceCompletion({ summary: 's', outcome: 'success' });

    // Caller builds the TerminationInput from the store state — we
    // simulate that wiring here to assert the integration is live.
    const after = evaluateTermination({
      announceCompletion: announcementStore.hasAnnounced(),
    });
    expect(after.shouldTerminate).toBe(true);
    expect(after.confidence).toBe('medium');
  });
});
