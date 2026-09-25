import { describe, it, expect } from 'bun:test';
import {
  handleNextFluentPreview, handleNextFluentDispatch, isNextFluentDispatchPath,
  NEXT_FLUENT_DISPATCH_PATH, type NextFluentRouteOpts,
} from './next-fluent.js';
import { createMissionNextActionSource } from '../../intent-prediction/next-action-source.js';

const post = (body: unknown) => new Request('http://x/v1/next-fluent/dispatch', { method: 'POST', body: JSON.stringify(body) });

const baseDeps = (over: Partial<NextFluentRouteOpts> = {}): NextFluentRouteOpts => ({
  deps: {
    source: createMissionNextActionSource({ lookupPhase: () => ({ isMissionPhase: true, status: 'failed', hasPr: false, missionCompleted: false, hasCritique: false }) }),
    enabled: () => true,
  },
  ...over,
});

describe('next-fluent dispatch route', () => {
  it('path 매칭', () => {
    expect(isNextFluentDispatchPath(NEXT_FLUENT_DISPATCH_PATH)).toBe(true);
    expect(isNextFluentDispatchPath('/v1/next-fluent/preview')).toBe(false);
  });
  it('dispatch 미배선 → 503', async () => {
    const res = await handleNextFluentDispatch(post({ refId: 'task:p1', action: 'rebuild' }), baseDeps());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'next-fluent-dispatch-not-wired' });
  });
  it('잘못된 body → 400', async () => {
    const opts = baseDeps({ dispatch: async () => ({ ok: true }) });
    expect((await handleNextFluentDispatch(post({ refId: '' }), opts)).status).toBe(400);
    expect((await handleNextFluentDispatch(post({ action: 'rebuild' }), opts)).status).toBe(400);
  });
  it('dispatch ok → 200·결과 반환', async () => {
    const opts = baseDeps({ dispatch: async (refId, action) => ({ ok: true, message: `${action}@${refId}` }) });
    const res = await handleNextFluentDispatch(post({ refId: 'task:p1', action: 'rebuild' }), opts);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: 'rebuild@task:p1' });
  });
  it('dispatch 실패 → 400·에러 전달', async () => {
    const opts = baseDeps({ dispatch: async () => ({ ok: false, error: 'phase-not-in-mission' }) });
    const res = await handleNextFluentDispatch(post({ refId: 'task:x', action: 'skip' }), opts);
    expect(res.status).toBe(400);
    expect((await res.json() as { error?: string }).error).toBe('phase-not-in-mission');
  });
  it('GET → 405', async () => {
    const res = await handleNextFluentDispatch(new Request('http://x/v1/next-fluent/dispatch', { method: 'GET' }), baseDeps({ dispatch: async () => ({ ok: true }) }));
    expect(res.status).toBe(405);
  });
});

describe('next-fluent preview route — 결정론(laneCallable 없음)', () => {
  it('enabled·failed 페이즈 → card(200) with 액션 제안', async () => {
    const res = await handleNextFluentPreview(
      new Request('http://x/v1/next-fluent/preview', { method: 'POST', body: JSON.stringify({ refId: 'task:p1', refKind: 'task', outcome: 'failed', completedAt: 1 }) }),
      baseDeps(),
    );
    expect(res.status).toBe(200);
    const card = (await res.json() as { card: { suggestions: { kind: string }[] } }).card;
    expect(card.suggestions.map((s) => s.kind)).toContain('rebuild');
  });
});
