// CV-3 β-1a · pure-helper tests for the HITL banner hook.
//
// PWA bun test env has no React Testing Library, so the hook itself
// (`useHitlBanner`) is exercised at the integration layer by E2E
// dogfood (Group I.5 in TEST-MANUAL). Here we lock the four pure
// helpers extracted from the hook — together they cover the entire
// state-mutation + URL/response decision surface, mirroring the
// `use-voice-controller.test.ts` mapServerState/mapSocketState
// pattern (also pure-helper-only).
//
//   - parseShowDetail        — payload validator + defaults
//   - parseCancelRequestId   — cancel envelope parser
//   - reduceHitlBannerEvent  — show/cancel state reducer
//   - buildCallbackUrl       — base URL + requestId composer
//   - interpretSubmitResponse — HTTP status → outcome mapper

import { describe, expect, test } from 'bun:test';
import {
  buildCallbackUrl,
  interpretSubmitResponse,
  parseCancelRequestId,
  parseShowDetail,
  reduceHitlBannerEvent,
  type PendingHitlBanner,
} from './use-hitl-banner';

const sample: PendingHitlBanner = {
  requestId: 'r-fresh',
  prompt: 'Approve?',
  yesLabel: 'Yes',
  noLabel: 'No',
};

describe('parseShowDetail', () => {
  test('returns null when detail is null/undefined', () => {
    expect(parseShowDetail(null)).toBeNull();
    expect(parseShowDetail(undefined)).toBeNull();
  });

  test('returns null when requestId or prompt missing', () => {
    expect(parseShowDetail({ prompt: 'hi' })).toBeNull();
    expect(parseShowDetail({ requestId: 'r1' })).toBeNull();
  });

  test('rejects non-string requestId / prompt', () => {
    expect(parseShowDetail({ requestId: 1, prompt: 'hi' })).toBeNull();
    expect(parseShowDetail({ requestId: 'r1', prompt: 7 })).toBeNull();
  });

  test('returns shape with default labels when omitted', () => {
    expect(parseShowDetail({ requestId: 'r1', prompt: 'OK?' })).toEqual({
      requestId: 'r1',
      prompt: 'OK?',
      yesLabel: 'Yes',
      noLabel: 'No',
    });
  });

  test('preserves caller-supplied labels + detail', () => {
    expect(
      parseShowDetail({
        requestId: 'r2',
        prompt: 'Edit?',
        detail: 'src/x.ts',
        yesLabel: 'Approve',
        noLabel: 'Deny',
      }),
    ).toEqual({
      requestId: 'r2',
      prompt: 'Edit?',
      detail: 'src/x.ts',
      yesLabel: 'Approve',
      noLabel: 'Deny',
    });
  });

  test('drops detail when not a string', () => {
    expect(parseShowDetail({ requestId: 'r3', prompt: 'OK?', detail: 42 })).toEqual({
      requestId: 'r3',
      prompt: 'OK?',
      yesLabel: 'Yes',
      noLabel: 'No',
    });
  });
});

describe('parseCancelRequestId', () => {
  test('returns the requestId string', () => {
    expect(parseCancelRequestId({ requestId: 'r1' })).toBe('r1');
  });
  test('returns null when malformed', () => {
    expect(parseCancelRequestId(null)).toBeNull();
    expect(parseCancelRequestId({})).toBeNull();
    expect(parseCancelRequestId({ requestId: 7 })).toBeNull();
  });
});

describe('reduceHitlBannerEvent', () => {
  test('show populates pending', () => {
    const next = reduceHitlBannerEvent(null, 'hitl.banner.show', {
      requestId: 'r1',
      prompt: 'OK?',
    });
    expect(next?.requestId).toBe('r1');
  });

  test('show with malformed payload preserves prior state', () => {
    expect(reduceHitlBannerEvent(sample, 'hitl.banner.show', { foo: 'bar' })).toBe(sample);
  });

  test('show replaces an active banner (server-side race survivor)', () => {
    const next = reduceHitlBannerEvent(sample, 'hitl.banner.show', {
      requestId: 'r-other',
      prompt: 'B?',
    });
    expect(next?.requestId).toBe('r-other');
    expect(next?.prompt).toBe('B?');
  });

  test('cancel matching requestId clears', () => {
    expect(
      reduceHitlBannerEvent(sample, 'hitl.banner.cancel', { requestId: 'r-fresh' }),
    ).toBeNull();
  });

  test('cancel with different requestId leaves pending intact', () => {
    expect(
      reduceHitlBannerEvent(sample, 'hitl.banner.cancel', { requestId: 'r-stale' }),
    ).toBe(sample);
  });

  test('cancel without a requestId clears (defensive — assume targeted)', () => {
    expect(
      reduceHitlBannerEvent(sample, 'hitl.banner.cancel', null),
    ).toBeNull();
  });

  test('cancel when no banner active is a no-op', () => {
    expect(reduceHitlBannerEvent(null, 'hitl.banner.cancel', { requestId: 'r1' })).toBeNull();
  });

  test('unknown event kind is a no-op', () => {
    expect(reduceHitlBannerEvent(sample, 'something.else', {})).toBe(sample);
  });
});

describe('buildCallbackUrl', () => {
  test('strips trailing slash from baseUrl', () => {
    expect(buildCallbackUrl('http://x/', 'r1')).toBe('http://x/v1/hitl/callback/r1');
  });
  test('keeps baseUrl path components', () => {
    expect(buildCallbackUrl('http://x:31415', 'r1')).toBe('http://x:31415/v1/hitl/callback/r1');
  });
  test('encodes requestId components', () => {
    expect(buildCallbackUrl('http://x', 'a/b c')).toBe('http://x/v1/hitl/callback/a%2Fb%20c');
  });
});

describe('interpretSubmitResponse', () => {
  test('200/201 → cleared', () => {
    expect(interpretSubmitResponse(200)).toEqual({ kind: 'cleared' });
    expect(interpretSubmitResponse(201)).toEqual({ kind: 'cleared' });
  });
  test('404 → cleared (sibling already won)', () => {
    expect(interpretSubmitResponse(404)).toEqual({ kind: 'cleared' });
  });
  test('500 → error with HTTP message', () => {
    expect(interpretSubmitResponse(500)).toEqual({ kind: 'error', message: 'HTTP 500' });
  });
  test('400 → error (validation failure)', () => {
    expect(interpretSubmitResponse(400)).toEqual({ kind: 'error', message: 'HTTP 400' });
  });
  test('301 → error (unexpected redirect)', () => {
    expect(interpretSubmitResponse(301)).toEqual({ kind: 'error', message: 'HTTP 301' });
  });
});
