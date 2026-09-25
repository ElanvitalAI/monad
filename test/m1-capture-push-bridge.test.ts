// Phase E · M1 × capture-push bridge — final-report fanout.

import { describe, expect, test } from 'bun:test';
import {
  createCapturePushDispatcher,
  type CapturePushPayload,
  type CapturePushSink,
} from '../src/capture/capture-push.js';
import { dispatchM1FinalReport } from '../src/voice/m1-capture-push-bridge.js';
import type { M1Session } from '../src/voice/m1-handoff-orchestrator.js';

const fakeSession: M1Session = {
  id: 'm1-test-1',
  transcript: '어제 build 실패 봐줘',
  originChannel: { kind: 'telegram', id: '7' },
  activeChannel: { kind: 'telegram', id: '7' },
  subagentId: 'sub-1',
  startedAt: '2026-05-03T08:00:00.000Z',
  finalOutcome: 'spoken',
};

describe('dispatchM1FinalReport', () => {
  test('returns artifactPushed=false + empty outcomes when no artifact', async () => {
    const dispatcher = createCapturePushDispatcher();
    let sentCount = 0;
    dispatcher.register({
      kind: 'telegram', id: '7',
      send: async () => { sentCount++; },
    });

    const result = await dispatchM1FinalReport(
      {
        session: fakeSession,
        utterance: '빌드 통과했어요',
        artifact: null,
      },
      { dispatcher },
    );

    expect(result.artifactPushed).toBe(false);
    expect(result.outcomes).toHaveLength(0);
    expect(sentCount).toBe(0); // dispatcher not called
  });

  test('with artifact — fans out to all sinks with caption embedded', async () => {
    const dispatcher = createCapturePushDispatcher();
    const captures: CapturePushPayload[] = [];
    dispatcher.register({
      kind: 'telegram', id: '7',
      send: async (p) => { captures.push(p); },
    });
    dispatcher.register({
      kind: 'pushcut', id: 'ipad',
      send: async (p) => { captures.push(p); },
    });

    const result = await dispatchM1FinalReport(
      {
        session: fakeSession,
        utterance: '빌드 실패. stack trace 분석 후 fix 적용했어요',
        artifact: {
          bodyBase64: 'PNG-bytes',
          mimeType: 'image/png',
          surfaceLabel: 'vw:1/build',
          capturedAt: 1700000000000,
        },
      },
      { dispatcher },
    );

    expect(result.artifactPushed).toBe(true);
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes.every((o) => o.status === 'sent')).toBe(true);

    expect(captures).toHaveLength(2);
    const tgPayload = captures[0]!;
    expect(tgPayload.caption).toContain('[M1]');
    expect(tgPayload.caption).toContain('vw:1/build');
    expect(tgPayload.caption).toContain('m1-test-1');
    expect(tgPayload.surfaceLabel).toBe('vw:1/build');
    expect(tgPayload.capturedAt).toBe(1700000000000);
  });

  test('caption auto-truncates at 1024 chars', async () => {
    const dispatcher = createCapturePushDispatcher();
    let captured: CapturePushPayload | null = null;
    dispatcher.register({
      kind: 'telegram', id: '7',
      send: async (p) => { captured = p; },
    });

    const longUtterance = 'x'.repeat(2000);
    await dispatchM1FinalReport(
      {
        session: fakeSession,
        utterance: longUtterance,
        artifact: { bodyBase64: 'x', mimeType: 'image/png', surfaceLabel: 'vw:1/build' },
      },
      { dispatcher },
    );

    expect((captured as unknown as CapturePushPayload).caption!.length).toBeLessThanOrEqual(1024);
    expect((captured as unknown as CapturePushPayload).caption!.endsWith('…')).toBe(true);
  });

  test('custom buildCaption is honored', async () => {
    const dispatcher = createCapturePushDispatcher();
    let captured: CapturePushPayload | null = null;
    dispatcher.register({
      kind: 'telegram', id: '7',
      send: async (p) => { captured = p; },
    });

    await dispatchM1FinalReport(
      {
        session: fakeSession,
        utterance: 'done',
        artifact: { bodyBase64: 'x', mimeType: 'image/png' },
      },
      {
        dispatcher,
        buildCaption: (input) => `CUSTOM·${input.session.id}·${input.utterance}`,
      },
    );

    expect((captured as unknown as CapturePushPayload).caption).toBe('CUSTOM·m1-test-1·done');
  });

  test('filter narrows fanout', async () => {
    const dispatcher = createCapturePushDispatcher();
    let tgSent = false;
    let dcSent = false;
    dispatcher.register({
      kind: 'telegram', id: '7',
      send: async () => { tgSent = true; },
    });
    dispatcher.register({
      kind: 'discord', id: 'wh-1',
      send: async () => { dcSent = true; },
    });

    const result = await dispatchM1FinalReport(
      {
        session: fakeSession,
        utterance: 'done',
        artifact: { bodyBase64: 'x', mimeType: 'image/png' },
      },
      {
        dispatcher,
        filter: (sink: CapturePushSink) => sink.kind === 'telegram',
      },
    );

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]!.kind).toBe('telegram');
    expect(tgSent).toBe(true);
    expect(dcSent).toBe(false);
  });

  test('per-sink failure preserved in outcomes (isolation)', async () => {
    const dispatcher = createCapturePushDispatcher();
    dispatcher.register({
      kind: 'telegram', id: '7',
      send: async () => { throw new Error('telegram down'); },
    });
    dispatcher.register({
      kind: 'pushcut', id: 'ipad',
      send: async () => {},
    });

    const result = await dispatchM1FinalReport(
      {
        session: fakeSession,
        utterance: 'done',
        artifact: { bodyBase64: 'x', mimeType: 'image/png' },
      },
      { dispatcher },
    );

    expect(result.outcomes).toHaveLength(2);
    const tg = result.outcomes.find((o) => o.kind === 'telegram')!;
    const pc = result.outcomes.find((o) => o.kind === 'pushcut')!;
    expect(tg.status).toBe('failed');
    expect(tg.error).toContain('telegram down');
    expect(pc.status).toBe('sent');
  });
});
