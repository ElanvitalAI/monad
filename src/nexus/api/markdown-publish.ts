// ── external-markdown 게시 라우트 handler — 미션 e4f97b 배선 마무리 (2026-07-23) ──
//
// orphan 이던 MarkdownPublisher + createGlobalRequestLimiter 를 POST 라우트로 배선한다(리뷰 FAIL
// 근본 = src/publishing 모듈이 어디서도 소비 안 됨). limiter 로 rate/concurrency 제한 후 publish.
// deps 주입(publisher·limiter)이라 순수-ish·결정론 테스트 가능. http-server 는 dispatch 1줄 + 팩토리.

import { MarkdownPublisher, MarkdownPublishError } from '../../publishing/markdown-publisher.js';
import { createPublishArtifactStore, PublishStoreError } from '../../publishing/artifact-store.js';
import { createMarkdownRenderer } from '../../publishing/markdown-renderer.js';
import type { PublishRequest, PublishMarkdownResult, PublishTarget } from '../../publishing/types.js';
import { createGlobalRequestLimiter, type GlobalRequestLimiter } from './request-limiter.js';
import { isS3Available, uploadText, s3PublicUrl, s3Config } from '../../storage/s3.js';
import { isValidPublishId } from '../../publishing/artifact-store.js';
import { execFileSync } from 'node:child_process';
import { elanousStateRoot } from '../../autopilot/state-paths.js';

/** publish 능력(테스트 주입 seam) — MarkdownPublisher 축소 계약. */
export interface PublishCapable {
  publish(request: PublishRequest): PublishMarkdownResult;
}

/** 게시물 조회 능력(테스트 주입 seam) — artifact-store 축소 계약. */
export interface ArtifactReadable {
  readPublicArtifact(id: string, target: PublishTarget): string;
}

export interface MarkdownPublishDeps {
  publisher: PublishCapable;
  limiter: GlobalRequestLimiter;
  /** 게시물 GET 서빙용(readPublicArtifact). 서비스 구성 시 실 store 주입. */
  store?: ArtifactReadable;
  /** ★ 외부 공개 서피스(SECURITY-external-publishing) — 렌더 HTML 을 S3 공개 버킷에 업로드하고 공개 URL 반환
   *  (없거나 null 이면 내부 전용). 정적만 공개·nexus 제어면 비노출. 주입 seam(테스트). */
  publishToS3?: (id: string, html: string) => string | null;
}

/** ★ POST /v1/publish/markdown — 마크다운을 정적 HTML 로 게시. limiter 통과 후 publish. 성공 시 내부(/d/:id)
 *  + (S3 가용 시) 외부 공개 URL(publicUrl) 을 함께 반환. limiter 거부=429·파싱실패=400·검증실패=422·기타=500. */
export function handleMarkdownPublish(rawBody: string, deps: MarkdownPublishDeps): Response {
  const permit = deps.limiter.acquire();
  if (!permit.ok) return permit.response; // 429 — rate/concurrency(리미터가 준비한 Response)
  try {
    let request: PublishRequest;
    try { request = JSON.parse(rawBody) as PublishRequest; }
    catch { return Response.json({ error: 'invalid_json' }, { status: 400 }); }
    // retention 입력 검증(#5194 리뷰) — 임의 문자열이 조용히 default 처리되지 않게 명시 거부.
    if (request.retention !== undefined && request.retention !== 'default' && request.retention !== 'permanent') {
      return Response.json({ error: 'invalid_retention', message: "retention must be 'default' or 'permanent'" }, { status: 400 });
    }
    const result = deps.publisher.publish(request);
    // ★ dual-surface — 로컬(내부 /d/:id) 게시 성공 후, S3 공개 업로드로 외부 publicUrl 확보(fail-soft:
    //   S3 실패가 로컬 게시를 막지 않는다). 텔레그램 공유는 publicUrl(공개·nexus 노출 0).
    let publicUrl: string | undefined;
    if (deps.store && deps.publishToS3) {
      try {
        const html = deps.store.readPublicArtifact(result.id, request.target);
        publicUrl = deps.publishToS3(result.id, html) ?? undefined;
      } catch { /* S3 업로드 실패 = fail-soft(로컬은 성공·내부 URL 로 접근 가능) */ }
    }
    return Response.json({ ...result, ...(publicUrl ? { publicUrl } : {}) }, { status: 201 });
  } catch (e) {
    if (e instanceof MarkdownPublishError) {
      return Response.json({ error: 'publish_rejected', message: e.message }, { status: 422 });
    }
    return Response.json({ error: 'publish_failed' }, { status: 500 });
  } finally {
    permit.release(); // 동시성 permit 반환(성공·실패 무관)
  }
}

/** ★ GET /d/:id — 게시된 정적 HTML 서빙(게시→열람 왕복 완성). 기본 target=funnel(1차 웹 타깃).
 *  missing/invalid → 404 · expired → 410 · 성공 → text/html. deps.store 미주입 시 503(서빙 미구성). */
export function handleMarkdownServe(id: string, deps: MarkdownPublishDeps, target: PublishTarget = 'funnel'): Response {
  if (!deps.store) return Response.json({ error: 'serve_unavailable' }, { status: 503 });
  try {
    const html = deps.store.readPublicArtifact(id, target);
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  } catch (e) {
    if (e instanceof PublishStoreError) {
      const code = e.detail.code;
      if (code === 'expired') return Response.json({ error: 'expired' }, { status: 410 });
      return Response.json({ error: 'not_found', code }, { status: 404 }); // missing/invalid_input
    }
    return Response.json({ error: 'serve_failed' }, { status: 500 });
  }
}

export interface MarkdownPublishServiceOptions {
  /** artifact 저장 루트 디렉토리. */
  root: string;
  /** canonical origin(예: tailscale serve URL) — 렌더 canonical + publish origin. */
  origin: string;
}

/** S3 공개 게시 prefix — <공개 버킷>/monad/publish/<id>/index.html (bucket-wide public-read · 공개 버킷 = storage.s3.publicBucket). */
export const S3_PUBLISH_PREFIX = 'monad/publish';
/** S3 콜드 백업 prefix — 만료 게시물을 Glacier 로 이관(백업·삭제 아님·콜드리드). */
export const S3_PUBLISH_COLD_PREFIX = 'monad/publish-cold';

/** ★ 만료 게시물 S3 콜드 백업(GC용) — hot(공개 STANDARD) → cold(Glacier)로 이관 후 hot 제거. 삭제 아닌
 *  백업이라 콜드리드(Glacier restore) 가능. pruneExpiredPublications 의 archiveToS3Cold 실 구현.
 *  ★id 는 execFileSync(셸 미경유) + isValidPublishId 이중 방어(command injection·#5194 리뷰). */
export function archivePublicationToS3Cold(id: string): void {
  if (!isValidPublishId(id)) throw new Error(`archive: invalid publish id: ${id.slice(0, 24)}`);
  const bucket = s3Config().publicBucket;   // 게시는 공개 버킷 기능이다(2026-09-26 버킷 분리)
  if (!bucket) throw new Error('archive: S3 공개 버킷이 설정되지 않았다(storage.s3.publicBucket)');
  const hot = `s3://${bucket}/${S3_PUBLISH_PREFIX}/${id}/`;
  const cold = `s3://${bucket}/${S3_PUBLISH_COLD_PREFIX}/${id}/`;
  execFileSync('aws', ['s3', 'cp', hot, cold, '--recursive', '--storage-class', 'GLACIER', '--quiet'], { stdio: 'ignore' });
  execFileSync('aws', ['s3', 'rm', hot, '--recursive', '--quiet'], { stdio: 'ignore' });
}

/** ★ 게시물 라이프사이클 GC 실행(프로덕션 배선·#5194 리뷰 — 종전 dead 였던 prune/archive 를 실 호출로).
 *  실 store 열어 pruneExpiredPublications(archiveToS3Cold=archivePublicationToS3Cold) 집행. elanous schedule
 *  크론 또는 CLI(`elanous publish gc`)가 호출. 만료→S3 콜드 백업(삭제 아님)·permanent 자동보존. */
export async function runPublishGc(opts: { root?: string; now?: () => number } = {}): Promise<{ archived: string[]; kept: number; errors: Array<{ id: string; error: string }> }> {
  const { createPublishArtifactStore } = await import('../../publishing/artifact-store.js');
  const { pruneExpiredPublications } = await import('../../publishing/publish-lifecycle.js');
  const root = opts.root || process.env.ELANOUS_PUBLISH_ROOT || `${elanousStateRoot()}/publishing`;
  const store = createPublishArtifactStore({ root });
  return pruneExpiredPublications({ store, archiveToS3Cold: archivePublicationToS3Cold, ...(opts.now ? { now: opts.now } : {}) });
}

/** 공개 콘텐츠 카탈로그(피드 보드 데이터 소스)를 빌드 — 전 게시물 매니페스트를 newest-first 공개 레코드로
 *  프로젝션(만료·타깃없음 제외). `elanous publish catalog` CLI 와 피드 렌더러가 소비하는 프로덕션 읽기 경로. */
export async function buildPublishCatalog(opts: { root?: string; now?: () => number } = {}): Promise<import('../../publishing/catalog.js').CatalogRecord[]> {
  const { createPublishArtifactStore } = await import('../../publishing/artifact-store.js');
  const { buildCatalog } = await import('../../publishing/catalog.js');
  const root = opts.root || process.env.ELANOUS_PUBLISH_ROOT || `${elanousStateRoot()}/publishing`;
  const store = createPublishArtifactStore({ root });
  return buildCatalog(store.list(), opts.now ? opts.now() : Date.now());
}

/** ★ 실 게시 서비스 구성(http-server 부팅 시 1회) — 실 MarkdownPublisher + 전역 limiter + S3 공개 업로더. */
export function createMarkdownPublishService(opts: MarkdownPublishServiceOptions): MarkdownPublishDeps {
  const store = createPublishArtifactStore({ root: opts.root });
  const render = createMarkdownRenderer(opts.origin);
  const publisher = new MarkdownPublisher({ store, origin: opts.origin, render });
  const limiter = createGlobalRequestLimiter();
  // ★ 외부 공개 = S3 공개 버킷(정적만·제어면 비노출). aws 미가용/실패 시 null → 내부 전용(fail-soft).
  const publishToS3 = (id: string, html: string): string | null => {
    if (!isS3Available()) return null;
    const key = `${S3_PUBLISH_PREFIX}/${id}/index.html`;
    uploadText(html, key, 'text/html; charset=utf-8');
    return s3PublicUrl(key);
  };
  return { publisher, limiter, store, publishToS3 }; // store=GET 서빙·publishToS3=외부 공개
}

let _defaultService: MarkdownPublishDeps | null = null;

/** ★ http-server 라우트용 lazy 싱글턴 — 서비스를 1회만 구성(store/limiter 재사용). root/origin 은
 *  user-config(env override) — ELANOUS_PUBLISH_ROOT(기본 ~/.elanous/publishing)·ELANOUS_PUBLISH_ORIGIN
 *  (기본 localhost·tailscale serve 시 그 URL 로 설정). */
export function getDefaultMarkdownPublishService(): MarkdownPublishDeps {
  if (!_defaultService) {
    const root = process.env.ELANOUS_PUBLISH_ROOT || `${elanousStateRoot()}/publishing`;
    const origin = process.env.ELANOUS_PUBLISH_ORIGIN || 'http://localhost:8787';
    _defaultService = createMarkdownPublishService({ root, origin });
  }
  return _defaultService;
}
