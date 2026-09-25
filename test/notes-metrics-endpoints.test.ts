// R-OCR.4.2 — handleNotesMetricsSnapshot + handleNotesMetricsEvent.
//
// Covers:
//   GET snapshot
//     - omitted collector → empty snapshot + wired:false
//     - wired collector  → live counts + wired:true
//   POST event
//     - omitted collector → 503 metrics_not_wired
//     - bad JSON / unknown type → 400
//     - happy path           → collector.recordClientEvent called
//     - OPTIONS preflight    → 204 + CORS headers
//
// Cross-ref:
//   src/nexus/api/metrics-notes.ts (handlers)
//   src/notes/metrics.ts (collector)

import { describe, expect, test } from 'bun:test';

import {
  handleNotesMetricsSnapshot,
  handleNotesMetricsEvent,
} from '../src/nexus/api/metrics-notes.js';
import { createNotesMetricsCollector } from '../src/notes/metrics.js';

function makeGet(): Request {
  return new Request('http://localhost/v1/metrics/notes-from-image');
}

function makePostEvent(body: unknown): Request {
  return new Request('http://localhost/v1/metrics/notes-event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('handleNotesMetricsSnapshot', () => {
  test('omitted collector → empty snapshot · wired:false · 200', async () => {
    const res = handleNotesMetricsSnapshot(makeGet(), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.wired).toBe(false);
    expect(body.snapshot.ocr.total).toBe(0);
    expect(body.snapshot.save.total).toBe(0);
    expect(body.snapshot.client).toEqual({ cancel: 0, edit: 0, discard: 0 });
  });

  test('wired collector returns live counts · wired:true', async () => {
    const metrics = createNotesMetricsCollector();
    metrics.recordOcr({ provider: 'upstage', polishMode: 'minimal', ok: true });
    metrics.recordSave({ polishMode: 'minimal', ok: true });
    metrics.recordClientEvent({ type: 'cancel' });
    const res = handleNotesMetricsSnapshot(makeGet(), { metrics });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.wired).toBe(true);
    expect(body.snapshot.ocr.total).toBe(1);
    expect(body.snapshot.ocr.byProvider.upstage).toBe(1);
    expect(body.snapshot.save.total).toBe(1);
    expect(body.snapshot.client.cancel).toBe(1);
  });
});

describe('handleNotesMetricsEvent', () => {
  test('OPTIONS → 204 + CORS headers', async () => {
    const req = new Request('http://localhost/v1/metrics/notes-event', { method: 'OPTIONS' });
    const res = await handleNotesMetricsEvent(req, {});
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  test('omitted collector → 503 metrics_not_wired', async () => {
    const res = await handleNotesMetricsEvent(makePostEvent({ type: 'cancel' }), {});
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('metrics_not_wired');
  });

  test('non-POST → 405', async () => {
    const req = new Request('http://localhost/v1/metrics/notes-event', { method: 'GET' });
    const res = await handleNotesMetricsEvent(req, { metrics: createNotesMetricsCollector() });
    expect(res.status).toBe(405);
  });

  test('invalid JSON → 400', async () => {
    const res = await handleNotesMetricsEvent(makePostEvent('not-json'), {
      metrics: createNotesMetricsCollector(),
    });
    expect(res.status).toBe(400);
  });

  test('unknown type → 400', async () => {
    const res = await handleNotesMetricsEvent(makePostEvent({ type: 'submit' }), {
      metrics: createNotesMetricsCollector(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain('cancel|edit|discard');
  });

  test('happy path · cancel → recordClientEvent called', async () => {
    const metrics = createNotesMetricsCollector();
    const res = await handleNotesMetricsEvent(makePostEvent({ type: 'cancel' }), { metrics });
    expect(res.status).toBe(200);
    expect(metrics.snapshot().client.cancel).toBe(1);
  });

  test('happy path · edit + polishMode → recorded', async () => {
    const metrics = createNotesMetricsCollector();
    const res = await handleNotesMetricsEvent(
      makePostEvent({ type: 'edit', polishMode: 'enrich' }),
      { metrics },
    );
    expect(res.status).toBe(200);
    expect(metrics.snapshot().client.edit).toBe(1);
  });

  test('happy path · discard', async () => {
    const metrics = createNotesMetricsCollector();
    const res = await handleNotesMetricsEvent(makePostEvent({ type: 'discard' }), { metrics });
    expect(res.status).toBe(200);
    expect(metrics.snapshot().client.discard).toBe(1);
  });
});
