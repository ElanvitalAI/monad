import { describe, expect, test } from 'bun:test';

import {
  IntakeHttpClientError,
  createIntakeHttpClient,
} from '../src/intake-plane/http-client.js';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('createIntakeHttpClient', () => {
  test('creates intake and sends bearer auth', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const client = createIntakeHttpClient({
      baseUrl: 'http://daemon.local',
      token: 'secret-token',
      fetchImpl: (async (input: string | URL, init?: RequestInit) => {
        calls.push({ input: String(input), init });
        return jsonResponse({
          intakeId: 'api-1',
          state: 'review-ready',
          source: 'api',
          receivedAt: '2026-04-30T12:00:00.000Z',
          updatedAt: '2026-04-30T12:00:00.000Z',
          actor: null,
          channelContext: null,
          draft: {
            title: 'compare two repos',
            summary: 'summary',
            itemCount: 1,
            openQuestionCount: 0,
            suggestedMode: 'task-creation',
            confidence: 0.91,
            items: [],
            openQuestions: [],
          },
          decisionMode: null,
          decision: null,
          proposal: null,
          applyTokenPresent: false,
          nextActions: [{ kind: 'decide-apply-now', label: 'Apply now', intakeId: 'api-1', command: null }],
          raw: { text: 'compare two repos', transcriptSource: null, attachments: [] },
          scheduleText: null,
          output: 'captured',
          taskIds: null,
          taskId: null,
        });
      }) as typeof fetch,
    });
    const result = await client.create({ text: 'compare two repos' });
    expect(result.intakeId).toBe('api-1');
    expect(result.raw.text).toBe('compare two repos');
    expect(result.nextActions[0]?.kind).toBe('decide-apply-now');
    expect(calls[0]?.input).toBe('http://daemon.local/v1/intake');
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer secret-token');
  });

  test('lists sessions with query filters', async () => {
    const urls: string[] = [];
    const client = createIntakeHttpClient({
      baseUrl: 'http://daemon.local/',
      fetchImpl: (async (input: string | URL) => {
        urls.push(String(input));
        return jsonResponse({
          sessions: [{
            intakeId: 'api-2',
            state: 'review-ready',
            source: 'api',
            receivedAt: '2026-04-30T12:00:00.000Z',
            updatedAt: '2026-04-30T12:00:00.000Z',
            actor: null,
            channelContext: null,
            draft: {
              title: 'preview bug',
              summary: 'summary',
              itemCount: 1,
              openQuestionCount: 0,
              suggestedMode: 'task-creation',
            },
            decisionMode: null,
            scheduleText: null,
          }],
        });
      }) as typeof fetch,
    });
    const result = await client.list({ source: 'api', q: 'preview' });
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.draft?.title).toBe('preview bug');
    expect(urls[0]).toBe('http://daemon.local/v1/intake?source=api&q=preview');
  });

  test('shows detail and replays through action routes', async () => {
    const urls: string[] = [];
    const client = createIntakeHttpClient({
      baseUrl: 'http://daemon.local',
      fetchImpl: (async (input: string | URL) => {
        urls.push(String(input));
        if (String(input).endsWith('/events')) {
          return jsonResponse({ intakeId: 'api-1', events: [{ intakeId: 'api-1', kind: 'captured', createdAt: 'x', state: 'captured' }] });
        }
        if (String(input).endsWith('/review-view')) {
          return jsonResponse({
            intakeId: 'api-1',
            view: {
              type: 'intake-review',
              chrome: { title: 'Review intake · api-1' },
              config: { body: 'hello', actions: [{ label: 'Apply now', value: { kind: 'decide-apply-now', intakeId: 'api-1' } }] },
            },
          });
        }
        return jsonResponse({
          intakeId: 'api-1',
          state: 'proposed',
          source: 'api',
          receivedAt: '2026-04-30T12:00:00.000Z',
          updatedAt: '2026-04-30T12:00:00.000Z',
          actor: null,
          channelContext: null,
          draft: {
            title: 'compare two repos',
            summary: 'summary',
            itemCount: 1,
            openQuestionCount: 0,
            suggestedMode: 'task-creation',
            confidence: 0.9,
            items: [],
            openQuestions: [],
          },
          decisionMode: 'apply-now',
          decision: {
            mode: 'apply-now',
            approvedItemIds: ['i1'],
            deferredItemIds: [],
            clarifiedAnswers: {},
          },
          proposal: {
            objective: 'compare two repos',
            goalSlug: null,
            preferredSurfaces: null,
            budgetUsdRemaining: null,
            scheduleText: null,
            contextNotes: [],
          },
          applyTokenPresent: true,
          nextActions: [{ kind: 'apply', label: 'Apply proposed tasks', intakeId: 'api-1', command: null }],
          raw: { text: 'compare two repos', transcriptSource: null, attachments: [] },
          scheduleText: null,
          output: 'ok',
          applyToken: 'tok',
        });
      }) as typeof fetch,
    });
    const shown = await client.show('api-1');
    const reviewView = await client.reviewView('api-1');
    const replayed = await client.replay('api-1');
    const events = await client.events('api-1');
    expect(shown.nextActions[0]?.kind).toBe('apply');
    expect(reviewView.type).toBe('intake-review');
    expect(replayed.proposal?.objective).toBe('compare two repos');
    expect(events.events[0]?.kind).toBe('captured');
    expect(urls).toEqual([
      'http://daemon.local/v1/intake/api-1',
      'http://daemon.local/v1/intake/api-1/review-view',
      'http://daemon.local/v1/intake/api-1/replay',
      'http://daemon.local/v1/intake/api-1/events',
    ]);
  });

  test('throws IntakeHttpClientError on non-2xx response', async () => {
    const client = createIntakeHttpClient({
      baseUrl: 'http://daemon.local',
      fetchImpl: (async () => jsonResponse({ error: 'bad_request', reason: 'text required' }, { status: 400 })) as typeof fetch,
    });
    await expect(client.create({ text: '' })).rejects.toBeInstanceOf(IntakeHttpClientError);
    await expect(client.create({ text: '' })).rejects.toMatchObject({ status: 400 });
  });

  test('lists control signals with query filters', async () => {
    const urls: string[] = [];
    const client = createIntakeHttpClient({
      baseUrl: 'http://daemon.local',
      fetchImpl: (async (input: string | URL) => {
        urls.push(String(input));
        return jsonResponse({
          total: 1,
          limit: 10,
          latest: {
            id: 'ctrl-signal-1',
            kind: 'turn-submit-begin',
            urgency: 'priority',
            source: { kind: 'daemon-api', route: '/v1/prompt' },
            scope: { channel: 'daemon-public', surface: 'daemon-prompt' },
            createdAt: '2026-04-30T12:00:00.000Z',
          },
          countsByKind: { 'turn-submit-begin': 1 },
          items: [{
            id: 'ctrl-signal-1',
            kind: 'turn-submit-begin',
            urgency: 'priority',
            source: { kind: 'daemon-api', route: '/v1/prompt' },
            scope: { channel: 'daemon-public', surface: 'daemon-prompt' },
            createdAt: '2026-04-30T12:00:00.000Z',
          }],
        });
      }) as typeof fetch,
    });
    const result = await client.controlSignals({
      kind: 'turn-submit-begin',
      channel: 'daemon-public',
      surface: 'daemon-prompt',
      minUrgency: 'priority',
      limit: 10,
    });
    expect(result.total).toBe(1);
    expect(result.latest?.kind).toBe('turn-submit-begin');
    expect(urls[0]).toBe(
      'http://daemon.local/v1/control-signals?kind=turn-submit-begin&channel=daemon-public&surface=daemon-prompt&minUrgency=priority&limit=10',
    );
  });

  test('emits control signals through the public daemon api', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createIntakeHttpClient({
      baseUrl: 'http://daemon.local',
      token: 'secret',
      fetchImpl: (async (input: string | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return jsonResponse({
          id: 'ctrl-signal-2',
          kind: 'turn-submit-begin',
          urgency: 'priority',
          source: 'sensor',
          scope: { channel: 'daemon-public', surface: 'daemon-prompt' },
          createdAt: '2026-04-30T00:00:00.000Z',
        });
      }) as typeof fetch,
    });

    const result = await client.emitControlSignal({
      kind: 'turn-submit-begin',
      urgency: 'priority',
      source: 'sensor',
      scope: { channel: 'daemon-public', surface: 'daemon-prompt' },
    });

    expect(result.kind).toBe('turn-submit-begin');
    expect(calls[0]?.url).toBe('http://daemon.local/v1/control-signals');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({
      kind: 'turn-submit-begin',
      urgency: 'priority',
      source: 'sensor',
      scope: { channel: 'daemon-public', surface: 'daemon-prompt' },
    }));
  });

  test('lists simulator catalog metadata through the public daemon api', async () => {
    const calls: string[] = [];
    const client = createIntakeHttpClient({
      baseUrl: 'http://daemon.local',
      token: 'secret',
      fetchImpl: (async (input: string | URL) => {
        calls.push(String(input));
        return jsonResponse({
          scenarios: [{
            id: 'media-picture-smoke',
            family: 'media',
            label: 'Picture smoke',
            badge: 'MEDIA',
            summary: 'Inject a synthetic picture output and preview it through the media sink.',
            prerequisites: ['Dashboard chat view is available'],
            targets: ['dashboard', 'pwa'],
            injectKind: 'local-action',
            primaryObserveSurface: 'preview-modal',
            flow: ['Inject picture sample into last assistant output'],
            observe: ['Preview modal should open immediately'],
            expected: ['picture-ref typed block is selected'],
          }],
        });
      }) as typeof fetch,
    });

    const result = await client.simulations();
    expect(result.scenarios[0]?.id).toBe('media-picture-smoke');
    expect(calls[0]).toBe('http://daemon.local/v1/simulations');
  });
});
