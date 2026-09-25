// W9c Z13-a · /v1/next-fluent/preview HTTP wire.

import { describe, expect, test } from 'bun:test';
import {
  NEXT_FLUENT_PREVIEW_PATH,
  handleNextFluentPreview,
  isNextFluentPreviewPath,
} from '../../../src/nexus/api/next-fluent';
import { createStubNextActionSource } from '../../../src/intent-prediction/next-action-source';
import type { ShowroomLaneCallable } from '../../../src/task-orchestrator/surfaces/showroom-surface';
import type { NextFluentHookDeps } from '../../../src/task-orchestrator/next-fluent-hook';

const okBody = {
  refId: 't-1', refKind: 'task', finishedSurface: 'terminal-pane',
  outcome: 'ok', completedAt: 1000, tags: ['ci'],
};

function buildDeps(enabled = true): NextFluentHookDeps {
  const callable: ShowroomLaneCallable = async (input) => ({
    text: `${input.role}-out`,
    modelId: input.model,
  });
  return {
    laneCallable: callable,
    source: createStubNextActionSource(),
    enabled: () => enabled,
  };
}

function req(body: unknown, init: { method?: string } = {}) {
  return new Request(`http://x${NEXT_FLUENT_PREVIEW_PATH}`, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('isNextFluentPreviewPath', () => {
  test('exact match', () => {
    expect(isNextFluentPreviewPath(NEXT_FLUENT_PREVIEW_PATH)).toBe(true);
    expect(isNextFluentPreviewPath('/v1/next-fluent')).toBe(false);
  });
});

describe('handleNextFluentPreview · happy path', () => {
  test('returns 200 + card envelope', async () => {
    const res = await handleNextFluentPreview(req(okBody), { deps: buildDeps() });
    expect(res.status).toBe(200);
    const body = await res.json() as { card: { kind: string; suggestions: unknown[] } };
    expect(body.card.kind).toBe('next-fluent');
    expect(body.card.suggestions.length).toBeGreaterThan(0);
  });

  test('retroSummary + tags from body reach the hook', async () => {
    const res = await handleNextFluentPreview(
      req({ ...okBody, retroSummary: 'late deploy', tags: ['ci', 'urgent'] }),
      { deps: buildDeps() },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { card: { suggestions: Array<{ kind: string }> } };
    // The retro path unlocks the `open-retro-showroom` rule
    expect(body.card.suggestions.some((s) => s.kind === 'open-retro-showroom')).toBe(true);
  });
});

describe('handleNextFluentPreview · rejection envelopes', () => {
  test('405 on non-POST', async () => {
    const res = await handleNextFluentPreview(req(okBody, { method: 'GET' }), { deps: buildDeps() });
    expect(res.status).toBe(405);
  });

  test('401 when checkAuth fails', async () => {
    const res = await handleNextFluentPreview(req(okBody), { deps: buildDeps(), checkAuth: () => false });
    expect(res.status).toBe(401);
  });

  test('400 on invalid JSON', async () => {
    const res = await handleNextFluentPreview(req('not-json'), { deps: buildDeps() });
    expect(res.status).toBe(400);
  });

  test('400 on missing refId', async () => {
    const { refId: _drop, ...rest } = okBody;
    const res = await handleNextFluentPreview(req(rest), { deps: buildDeps() });
    expect(res.status).toBe(400);
  });

  test('400 on outcome other than ok|failed', async () => {
    const res = await handleNextFluentPreview(req({ ...okBody, outcome: 'partial' }), { deps: buildDeps() });
    expect(res.status).toBe(400);
  });

  test('400 on missing completedAt', async () => {
    const { completedAt: _drop, ...rest } = okBody;
    const res = await handleNextFluentPreview(req(rest), { deps: buildDeps() });
    expect(res.status).toBe(400);
  });

  test('disabled toggle returns 409 with enabled flag', async () => {
    const res = await handleNextFluentPreview(req(okBody), { deps: buildDeps(false) });
    expect(res.status).toBe(409);
    const body = await res.json() as { enabled: boolean };
    expect(body.enabled).toBe(false);
  });

  test('enabled but no suggestions → 204', async () => {
    const deps: NextFluentHookDeps = {
      laneCallable: async () => ({ text: '' }),
      source: { async top() { return []; } },
      enabled: () => true,
    };
    const res = await handleNextFluentPreview(req(okBody), { deps });
    expect(res.status).toBe(204);
  });
});
