/** Maximum UTF-8 byte length accepted for Markdown source (2 MiB). */
export const MAX_MARKDOWN_UTF8_BYTES = 2_097_152 as const;

/** Maximum normalized character length accepted for a supplied title. */
export const MAX_TITLE_CHARACTERS = 120 as const;

/** Maximum normalized character length accepted for a supplied description. */
export const MAX_DESCRIPTION_CHARACTERS = 300 as const;

/** Maximum UTF-8 byte length of rendered HTML (5 MiB). */
export const MAX_RENDERED_HTML_UTF8_BYTES = 5_242_880 as const;

/** Immutable publishing destinations supported by this service. */
export type PublishTarget = 'funnel' | 'cloudfront';

/** Public, target-specific artifact metadata recorded in a publish manifest. */
export type PublishTargetMetadata =
  | {
      readonly target: 'funnel';
      readonly artifactPath: 'targets/funnel/index.html';
      readonly origin: string;
      readonly url: string;
    }
  | {
      readonly target: 'cloudfront';
      readonly artifactPath: 'targets/cloudfront/index.html';
      readonly origin: string;
      readonly url: string;
    };

/** Metadata indexed by the complete set of supported publishing targets. */
export type PublishTargetMetadataByTarget = {
  readonly [Target in PublishTarget]?: Extract<PublishTargetMetadata, { readonly target: Target }>;
};

/** Public metadata used to project a published document into a content catalog (feed board). */
export interface CatalogMeta {
  readonly sourceType: 'youtube' | 'x' | 'web' | 'github' | 'notion' | 'investment' | 'obsidian' | 'other';
  readonly sourceUrl?: string;
  readonly domain: string;
  readonly tags: readonly string[];
  readonly contentDate?: string;
  readonly excerpt?: string;
  readonly thumbnail?: string;
}

/** Immutable, private manifest persisted for a published Markdown document. */
export interface PublishManifest {
  readonly version: 1;
  readonly id: PublishId;
  readonly createdAt: string;
  /** Exactly 30 days after `createdAt`; enforced when the manifest is created. */
  readonly expiresAt: string;
  readonly title: string;
  readonly description: string;
  readonly lang: string;
  /** Private-only path relative to this document's artifact directory. */
  readonly sourcePath: 'source.md';
  readonly sourceSha256: string;
  /** A target is published when its optional metadata entry is present. */
  readonly targets: PublishTargetMetadataByTarget;
  /** Optional public metadata for the catalog projection; absent on legacy manifests. */
  readonly catalog?: CatalogMeta;
}

/** Failure details for a target that could not be committed during a partial write. */
export interface PublishTargetFailure {
  readonly target: PublishTarget;
  readonly message: string;
}

/** Fields shared by every publishing failure. */
export interface PublishErrorBase {
  readonly code: PublishErrorCode;
  readonly message: string;
}

/** Stable discriminants for publishing failures. */
export type PublishErrorCode =
  | 'invalid_input'
  | 'oversize'
  | 'collision'
  | 'missing'
  | 'expired'
  | 'partial_write';

/** A discriminated error contract for callers of the immutable publisher. */
export type PublishError =
  | (PublishErrorBase & {
      readonly code: 'invalid_input';
      readonly field: 'markdown' | 'title' | 'description' | 'lang' | 'target';
    })
  | (PublishErrorBase & {
      readonly code: 'oversize';
      readonly field: 'markdown' | 'rendered_html';
      readonly actualBytes: number;
      readonly maxBytes: number;
    })
  | (PublishErrorBase & {
      readonly code: 'collision';
      readonly id: PublishId;
    })
  | (PublishErrorBase & {
      readonly code: 'missing';
      readonly id: PublishId;
    })
  | (PublishErrorBase & {
      readonly code: 'expired';
      readonly id: PublishId;
      readonly expiresAt: string;
    })
  | (PublishErrorBase & {
      readonly code: 'partial_write';
      readonly id: PublishId;
      readonly successfulTargets: readonly PublishTargetMetadata[];
      readonly failedTargets: readonly PublishTargetFailure[];
    });

/**
 * Nominal marker for a 16-byte CSPRNG value encoded as unpadded base64url.
 *
 * The string representation uses only RFC 4648 base64url characters
 * (`A-Z`, `a-z`, `0-9`, `_`, and `-`), is exactly 22 characters long, and
 * represents 128 bits of entropy. Runtime creation and validation are owned
 * by the publisher; this marker prevents arbitrary strings from being used as
 * publish IDs in type-checked code.
 */
declare const publishIdBrand: unique symbol;

export type PublishId = string & {
  readonly [publishIdBrand]: {
    readonly alphabet: 'A-Z a-z 0-9 _ -';
    readonly format: 'base64url-unpadded';
    readonly encodedLength: 22;
    readonly entropyBits: 128;
    readonly sourceBytes: 16;
  };
};

/**
 * Input accepted by the immutable Markdown publisher.
 *
 * `markdown` must be UTF-8 and no larger than MAX_MARKDOWN_UTF8_BYTES.
 * Supplied title and description are limited to MAX_TITLE_CHARACTERS and
 * MAX_DESCRIPTION_CHARACTERS after normalization. Runtime validation enforces
 * those limits and BCP 47 validity for `lang`.
 */
export interface PublishRequest {
  readonly markdown: string;
  readonly title?: string;
  readonly description?: string;
  readonly lang?: string;
  readonly target: PublishTarget;
  /** 보존 정책(대표 2026-07-23) — 'default'=기본 라이프사이클(1년→콜드 백업) · 'permanent'=영구보존
   *  (만료 없음·hot 유지·GC 콜드이관 제외). 미지정=default. */
  readonly retention?: 'default' | 'permanent';
  /** 공개 카탈로그 메타(피드 보드) — 게시 시 manifest.catalog 로 저장. 미지정 시 카탈로그 프로젝션에
   *  기본 필드(id·url·title·createdAt)만 노출. domain/tags/sourceType 은 intake 분류에서 채운다. */
  readonly catalog?: CatalogMeta;
}

/** 영구보존 게시물의 만료 표식 — 실제로 도래하지 않는 far-future(콜드GC expired 판정에서 자동 제외). */
export const PERMANENT_EXPIRES_AT = '9999-12-31T23:59:59.999Z';

/** Canonical result returned after an immutable document has been committed. */
export interface PublishMarkdownResult {
  readonly id: PublishId;
  readonly url: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** Backward-compatible RFC name for the Markdown publishing request. */
export type PublishMarkdownRequest = PublishRequest;
