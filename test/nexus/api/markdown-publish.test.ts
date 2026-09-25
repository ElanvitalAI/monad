import { describe, it, expect } from 'bun:test';
import { handleMarkdownPublish, handleMarkdownServe, type MarkdownPublishDeps } from '../../../src/nexus/api/markdown-publish.js';
import { MarkdownPublishError } from '../../../src/publishing/markdown-publisher.js';
import { PublishStoreError } from '../../../src/publishing/artifact-store.js';
import { createGlobalRequestLimiter } from '../../../src/nexus/api/request-limiter.js';
import type { PublishRequest, PublishMarkdownResult } from '../../../src/publishing/types.js';

// ★ 미션 e4f97b 배선 마무리 — orphan 이던 게시 handler 의 limiter+publish 계약.
const OK_RESULT: PublishMarkdownResult = { id: 'p'.repeat(21) as any, url: 'https://x/p', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-02-01T00:00:00.000Z' };
const fakePublisher = (impl?: (r: PublishRequest) => PublishMarkdownResult) => ({ publish: impl ?? (() => OK_RESULT) });
const body = (o: object) => JSON.stringify(o);

describe('handleMarkdownPublish', () => {
  it('정상 게시 → 201 + result', async () => {
    const deps: MarkdownPublishDeps = { publisher: fakePublisher(), limiter: createGlobalRequestLimiter() };
    const res = handleMarkdownPublish(body({ markdown: '# hi', target: 'funnel' }), deps);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(OK_RESULT as any);
  });

  it('★ S3 dual-surface — publishToS3 성공 → 201 + publicUrl', async () => {
    const store = { readPublicArtifact: () => '<html>hi</html>' };
    const deps: MarkdownPublishDeps = { publisher: fakePublisher(), limiter: createGlobalRequestLimiter(), store, publishToS3: (id) => `https://elanvital-public.s3.amazonaws.com/monad/publish/${id}/index.html` };
    const res = handleMarkdownPublish(body({ markdown: '# hi', target: 'funnel' }), deps);
    expect(res.status).toBe(201);
    const j = await res.json() as any;
    expect(j.publicUrl).toContain('elanvital-public.s3.amazonaws.com');
  });

  it('★ S3 미가용(null) → 201·publicUrl 없음(내부 전용)', async () => {
    const store = { readPublicArtifact: () => '<html>hi</html>' };
    const res = handleMarkdownPublish(body({ markdown: '# hi', target: 'funnel' }), { publisher: fakePublisher(), limiter: createGlobalRequestLimiter(), store, publishToS3: () => null });
    expect(res.status).toBe(201);
    expect((await res.json() as any).publicUrl).toBeUndefined();
  });

  it('★ S3 업로드 예외 → fail-soft(201·로컬 게시 유지·publicUrl 없음)', async () => {
    const store = { readPublicArtifact: () => '<html>hi</html>' };
    const res = handleMarkdownPublish(body({ markdown: '# hi', target: 'funnel' }), { publisher: fakePublisher(), limiter: createGlobalRequestLimiter(), store, publishToS3: () => { throw new Error('s3 down'); } });
    expect(res.status).toBe(201); // S3 실패가 게시를 막지 않음
    expect((await res.json() as any).publicUrl).toBeUndefined();
  });

  it('★ retention 임의값 → 400(조용한 default 처리 방지·#5194 리뷰)', () => {
    const store = { readPublicArtifact: () => '<html>hi</html>' };
    const res = handleMarkdownPublish(JSON.stringify({ markdown: '# hi', target: 'funnel', retention: 'forever' }), { publisher: fakePublisher(), limiter: createGlobalRequestLimiter(), store });
    expect(res.status).toBe(400);
  });

  it('★ retention permanent/default/미지정 → 통과(201)', () => {
    const mk = (r?: string) => handleMarkdownPublish(JSON.stringify({ markdown: '# hi', target: 'funnel', ...(r ? { retention: r } : {}) }), { publisher: fakePublisher(), limiter: createGlobalRequestLimiter() });
    expect(mk('permanent').status).toBe(201);
    expect(mk('default').status).toBe(201);
    expect(mk().status).toBe(201);
  });

  it('limiter 거부(concurrency) → 429', () => {
    // maxConcurrent=1 리미터에서 permit 을 미리 점유해 두 번째 acquire 를 거부시킨다.
    const limiter = createGlobalRequestLimiter({ maxConcurrent: 1 });
    const held = limiter.acquire();
    expect(held.ok).toBe(true);
    const res = handleMarkdownPublish(body({ markdown: '# hi', target: 'funnel' }), { publisher: fakePublisher(), limiter });
    expect(res.status).toBe(429);
    if (held.ok) held.release();
  });

  it('본문 JSON 파싱 실패 → 400', () => {
    const res = handleMarkdownPublish('{ not json', { publisher: fakePublisher(), limiter: createGlobalRequestLimiter() });
    expect(res.status).toBe(400);
  });

  it('MarkdownPublishError → 422', () => {
    const throwing = fakePublisher(() => { throw new MarkdownPublishError({ code: 'invalid_input', field: 'target', message: 'bad target' } as any); });
    const res = handleMarkdownPublish(body({ markdown: '# hi', target: 'nope' }), { publisher: throwing, limiter: createGlobalRequestLimiter() });
    expect(res.status).toBe(422);
  });

  it('기타 예외 → 500 + permit 반환(리미터 고갈 안 됨)', () => {
    const limiter = createGlobalRequestLimiter({ maxConcurrent: 1 });
    const throwing = fakePublisher(() => { throw new Error('boom'); });
    const res = handleMarkdownPublish(body({ markdown: '# hi', target: 'funnel' }), { publisher: throwing, limiter });
    expect(res.status).toBe(500);
    // permit 이 finally 로 반환됐으면 다음 acquire 가 성공(고갈 안 됨).
    const next = limiter.acquire();
    expect(next.ok).toBe(true);
  });
});

describe('handleMarkdownServe (GET /d/:id)', () => {
  const withStore = (impl: (id: string, t: string) => string): MarkdownPublishDeps => ({ publisher: fakePublisher(), limiter: createGlobalRequestLimiter(), store: { readPublicArtifact: impl } });

  it('게시물 존재 → 200 + text/html', async () => {
    const res = handleMarkdownServe('abc', withStore(() => '<html><body>hi</body></html>'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('hi');
  });

  it('missing → 404', () => {
    const res = handleMarkdownServe('nope', withStore(() => { throw new PublishStoreError({ code: 'missing', message: 'no' } as any); }));
    expect(res.status).toBe(404);
  });

  it('expired → 410', () => {
    const res = handleMarkdownServe('old', withStore(() => { throw new PublishStoreError({ code: 'expired', message: 'gone' } as any); }));
    expect(res.status).toBe(410);
  });

  it('store 미주입 → 503', () => {
    const res = handleMarkdownServe('x', { publisher: fakePublisher(), limiter: createGlobalRequestLimiter() });
    expect(res.status).toBe(503);
  });
});
