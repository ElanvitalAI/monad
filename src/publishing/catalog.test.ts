import { describe, expect, test } from 'bun:test';

import type { StoredDocument } from './artifact-store.js';
import { buildCatalog } from './catalog.js';
import {
  PERMANENT_EXPIRES_AT,
  type PublishId,
  type PublishManifest,
} from './types.js';

function document(input: {
  readonly id: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly targetUrl?: string;
  readonly cloudfrontUrl?: string;
  readonly catalog?: PublishManifest['catalog'];
}): StoredDocument {
  const id = input.id as PublishId;
  const targets: PublishManifest['targets'] = {
    ...(input.targetUrl
      ? { funnel: { target: 'funnel' as const, artifactPath: 'targets/funnel/index.html' as const, origin: 'https://publish.example', url: input.targetUrl } }
      : {}),
    ...(input.cloudfrontUrl
      ? { cloudfront: { target: 'cloudfront' as const, artifactPath: 'targets/cloudfront/index.html' as const, origin: 'https://cdn.example', url: input.cloudfrontUrl } }
      : {}),
  };
  return {
    id,
    manifest: {
      version: 1,
      id,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt ?? PERMANENT_EXPIRES_AT,
      title: `Title ${input.id}`,
      description: 'Description',
      lang: 'en',
      sourcePath: 'source.md',
      sourceSha256: 'sha256',
      targets,
      catalog: input.catalog,
    },
  };
}

describe('buildCatalog', () => {
  test('excludes expired documents while retaining permanent documents', () => {
    const records = buildCatalog([
      document({
        id: 'expired',
        createdAt: '2020-01-01T00:00:00.000Z',
        expiresAt: '2020-02-01T00:00:00.000Z',
        targetUrl: 'https://publish.example/expired',
      }),
      document({
        id: 'permanent',
        createdAt: '2020-01-02T00:00:00.000Z',
        expiresAt: PERMANENT_EXPIRES_AT,
        targetUrl: 'https://publish.example/permanent',
      }),
    ]);

    expect(records.map((record) => String(record.id))).toEqual(['permanent']);
  });

  test('sorts records by createdAt descending', () => {
    const records = buildCatalog([
      document({
        id: 'older',
        createdAt: '2025-01-01T00:00:00.000Z',
        targetUrl: 'https://publish.example/older',
      }),
      document({
        id: 'newer',
        createdAt: '2025-02-01T00:00:00.000Z',
        targetUrl: 'https://publish.example/newer',
      }),
    ]);

    expect(records.map((record) => String(record.id))).toEqual(['newer', 'older']);
  });

  test('projects catalog metadata into the public record', () => {
    const records = buildCatalog([
      document({
        id: 'metadata',
        createdAt: '2025-01-01T00:00:00.000Z',
        targetUrl: 'https://publish.example/metadata',
        catalog: {
          sourceType: 'youtube',
          sourceUrl: 'https://youtube.example/video',
          domain: 'ai',
          tags: ['models', 'research'],
          contentDate: '2024-12-31T00:00:00.000Z',
          excerpt: 'A preview',
          thumbnail: 'https://images.example/thumb.png',
        },
      }),
    ]);

    expect(records).toEqual([{
      id: 'metadata' as PublishId,
      url: 'https://publish.example/metadata',
      title: 'Title metadata',
      createdAt: '2025-01-01T00:00:00.000Z',
      sourceType: 'youtube',
      sourceUrl: 'https://youtube.example/video',
      domain: 'ai',
      tags: ['models', 'research'],
      contentDate: '2024-12-31T00:00:00.000Z',
      excerpt: 'A preview',
      thumbnail: 'https://images.example/thumb.png',
    }]);
  });

  test('skips documents without a published target URL', () => {
    const records = buildCatalog([
      document({
        id: 'missing-target',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    ]);

    expect(records).toEqual([]);
  });

  test('selects cloudfront URL over funnel by explicit priority (not insertion order)', () => {
    const [record] = buildCatalog([
      document({
        id: 'multi-target',
        createdAt: '2025-01-01T00:00:00.000Z',
        targetUrl: 'https://publish.example/funnel',
        cloudfrontUrl: 'https://cdn.example/cf',
      }),
    ]);

    expect(record.url).toBe('https://cdn.example/cf');
  });

  test('applies expiry against injected `now` for deterministic boundaries', () => {
    const docs = [
      document({
        id: 'boundary',
        createdAt: '2025-01-01T00:00:00.000Z',
        expiresAt: '2025-06-01T00:00:00.000Z',
        targetUrl: 'https://publish.example/boundary',
      }),
    ];

    const before = Date.parse('2025-05-31T23:59:59.000Z');
    const after = Date.parse('2025-06-01T00:00:01.000Z');
    expect(buildCatalog(docs, before).map((r) => String(r.id))).toEqual(['boundary']);
    expect(buildCatalog(docs, after)).toEqual([]);
  });

  test('drops documents with an unparsable expiresAt (fail-safe against unknown lifecycle)', () => {
    const records = buildCatalog([
      document({
        id: 'bad-date',
        createdAt: '2025-01-01T00:00:00.000Z',
        expiresAt: 'not-a-date',
        targetUrl: 'https://publish.example/bad',
      }),
    ]);

    expect(records).toEqual([]);
  });
});
