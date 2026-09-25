import { createHash, randomBytes } from 'node:crypto';

import { PUBLISH_TTL_MS, type PublishArtifactStore } from './artifact-store.js';
import { buildCatalog, type CatalogRecord } from './catalog.js';
import {
  MAX_MARKDOWN_UTF8_BYTES,
  PERMANENT_EXPIRES_AT,
  type PublishError,
  type PublishId,
  type PublishManifest,
  type PublishMarkdownResult,
  type PublishRequest,
  type PublishTarget,
} from './types.js';

const TARGETS = new Set<PublishTarget>(['funnel', 'cloudfront']);
const ID_BYTES = 16;

export class MarkdownPublishError extends Error {
  readonly detail: PublishError;

  constructor(detail: PublishError) {
    super(detail.message);
    this.name = 'MarkdownPublishError';
    this.detail = detail;
  }
}

export interface MarkdownPublisherDeps {
  readonly store: PublishArtifactStore;
  readonly origin: string;
  readonly now?: () => number;
  readonly randomBytes?: (size: number) => Buffer;
  readonly render: (request: PublishRequest) => string;
}

function validateRequest(request: PublishRequest): void {
  if (!TARGETS.has(request.target)) {
    throw new MarkdownPublishError({
      code: 'invalid_input',
      field: 'target',
      message: `unsupported publish target: ${String(request.target)}`,
    });
  }

  const actualBytes = Buffer.byteLength(request.markdown, 'utf8');
  if (actualBytes > MAX_MARKDOWN_UTF8_BYTES) {
    throw new MarkdownPublishError({
      code: 'oversize',
      field: 'markdown',
      actualBytes,
      maxBytes: MAX_MARKDOWN_UTF8_BYTES,
      message: `markdown exceeds ${MAX_MARKDOWN_UTF8_BYTES} UTF-8 bytes`,
    });
  }
}

/** Creates a 128-bit CSPRNG ID encoded as exactly 22 unpadded base64url chars. */
export function createPublishId(random: (size: number) => Buffer = randomBytes): PublishId {
  const bytes = random(ID_BYTES);
  if (bytes.length !== ID_BYTES) {
    throw new Error('publish ID random source returned wrong byte length');
  }
  return bytes.toString('base64url') as PublishId;
}

export class MarkdownPublisher {
  private readonly now: () => number;
  private readonly random: (size: number) => Buffer;

  constructor(private readonly deps: MarkdownPublisherDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.random = deps.randomBytes ?? randomBytes;
  }

  publish(request: PublishRequest): PublishMarkdownResult {
    validateRequest(request);

    const id = createPublishId(this.random);
    const createdAt = new Date(this.now()).toISOString();
    // ★ 보존 정책(대표 2026-07-23) — permanent 는 far-future(영구·GC 콜드이관 제외)·default 는 TTL(기본 1년).
    const expiresAt = request.retention === 'permanent'
      ? PERMANENT_EXPIRES_AT
      : new Date(Date.parse(createdAt) + PUBLISH_TTL_MS).toISOString();
    const url = new URL(`/d/${id}`, this.deps.origin).toString();
    const target = request.target;
    const manifest: PublishManifest = {
      version: 1,
      id,
      createdAt,
      expiresAt,
      title: request.title ?? 'Untitled summary',
      description: request.description ?? '',
      lang: request.lang ?? 'ko',
      sourcePath: 'source.md',
      sourceSha256: createHash('sha256').update(request.markdown, 'utf8').digest('hex'),
      targets: {
        [target]: {
          target,
          artifactPath: `targets/${target}/index.html`,
          origin: this.deps.origin,
          url,
        },
      },
      // ★ 공개 카탈로그 메타(피드 보드) — intake 분류(domain/tags/sourceType)를 매니페스트에 저장.
      //   미지정이면 카탈로그는 기본 필드(id·url·title·createdAt)만 프로젝션한다(후방호환).
      ...(request.catalog ? { catalog: request.catalog } : {}),
    } as PublishManifest;

    this.deps.store.commit({
      manifest,
      sourceMarkdown: request.markdown,
      targets: { [target]: this.deps.render(request) },
    });
    return { id, url, createdAt, expiresAt };
  }

  /**
   * Builds the public content catalog (newest-first) from every committed document.
   * This is the production read path that the feed board (and the `publish catalog`
   * CLI) consume; expired and target-less documents are excluded by `buildCatalog`.
   */
  catalog(): CatalogRecord[] {
    return buildCatalog(this.deps.store.list(), this.now());
  }
}
