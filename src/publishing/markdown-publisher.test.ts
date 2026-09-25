import { describe, expect, test } from 'bun:test';
import * as nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createPublishId,
  MarkdownPublisher,
  MarkdownPublishError,
} from './markdown-publisher.js';
import {
  createPublishArtifactStore,
  type CommitInput,
  type PublishArtifactStore,
  type StoredDocument,
} from './artifact-store.js';
import type { PublishManifest } from './types.js';
import { DEFAULT_OG_IMAGE_PNG, renderMarkdownDocument } from './markdown-renderer.js';

function storeRecorder(): { store: PublishArtifactStore; commits: CommitInput[] } {
  const commits: CommitInput[] = [];
  return {
    commits,
    store: {
      commit(input): StoredDocument {
        commits.push(input);
        return { id: input.manifest.id, manifest: input.manifest };
      },
      readManifest(): PublishManifest {
        throw new Error('not used');
      },
      readPublicArtifact(): string {
        throw new Error('not used');
      },
      isExpired(): boolean {
        return false;
      },
      delete(): void {},
      list(): readonly StoredDocument[] {
        return [];
      },
      recover(): void {},
    },
  };
}

describe('MarkdownPublisher', () => {
  test('commits private source and the selected public target in one request', () => {
    const recorded = storeRecorder();
    const publisher = new MarkdownPublisher({
      store: recorded.store,
      origin: 'https://device.tailnet.ts.net',
      now: () => Date.UTC(2025, 0, 1),
      randomBytes: () => Buffer.alloc(16, 7),
      render: () => '<article>rendered</article>',
    });

    const result = publisher.publish({ markdown: '# summary', target: 'funnel' });

    expect(result.id === ('BwcHBwcHBwcHBwcHBwcHBw' as typeof result.id)).toBe(true);
    expect(result.url).toBe(`https://device.tailnet.ts.net/d/${result.id}`);
    expect(result.createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(result.expiresAt).toBe('2026-01-01T00:00:00.000Z'); // 기본 라이프사이클 1년(대표 2026-07-23·종전 30일)
    expect(recorded.commits).toHaveLength(1);
    expect(recorded.commits[0]?.sourceMarkdown).toBe('# summary');
    expect(recorded.commits[0]?.targets).toEqual({ funnel: '<article>rendered</article>' });
    expect(recorded.commits[0]?.manifest.targets.funnel?.artifactPath).toBe('targets/funnel/index.html');
  });

  test('persists request.catalog into the manifest and surfaces it via catalog()', () => {
    const docs: StoredDocument[] = [];
    const store: PublishArtifactStore = {
      commit(input): StoredDocument {
        const doc = { id: input.manifest.id, manifest: input.manifest };
        docs.push(doc);
        return doc;
      },
      readManifest() { throw new Error('not used'); },
      readPublicArtifact() { throw new Error('not used'); },
      isExpired() { return false; },
      delete() {},
      list() { return docs; },
      recover() {},
    };
    const publisher = new MarkdownPublisher({
      store,
      origin: 'https://device.tailnet.ts.net',
      now: () => Date.UTC(2025, 0, 1),
      randomBytes: () => Buffer.alloc(16, 7),
      render: () => '<article>rendered</article>',
    });

    const result = publisher.publish({
      markdown: '# summary',
      target: 'funnel',
      catalog: { sourceType: 'youtube', domain: 'stocks', tags: ['HBM', '삼성전자'], sourceUrl: 'https://youtu.be/x' },
    });

    // 게시 시 매니페스트에 카탈로그 메타 저장(리뷰 must-fix #2)
    expect(docs[0]?.manifest.catalog?.domain).toBe('stocks');
    // 프로덕션 소비자 catalog() 가 카탈로그를 프로젝션(리뷰 must-fix #1 — 미배선 아님)
    const catalog = publisher.catalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({ id: result.id, url: result.url, domain: 'stocks', sourceType: 'youtube', tags: ['HBM', '삼성전자'] });
  });

  test('accepts the exact UTF-8 boundary and rejects invalid targets before side effects', () => {
    const recorded = storeRecorder();
    let renders = 0;
    const publisher = new MarkdownPublisher({
      store: recorded.store,
      origin: 'https://device.tailnet.ts.net',
      randomBytes: () => Buffer.alloc(16, 1),
      render: () => {
        renders++;
        return 'ok';
      },
    });

    publisher.publish({ markdown: '가'.repeat(699_050) + 'aa', target: 'cloudfront' });
    expect(recorded.commits).toHaveLength(1);
    expect(recorded.commits[0]?.manifest.targets.cloudfront?.artifactPath).toBe('targets/cloudfront/index.html');

    expect(() => publisher.publish({ markdown: 'x', target: 'invalid' as never })).toThrow(MarkdownPublishError);
    expect(renders).toBe(1);
    expect(recorded.commits).toHaveLength(1);
  });

  test('rejects over-limit multibyte Markdown before rendering or committing', () => {
    const recorded = storeRecorder();
    let renders = 0;
    const publisher = new MarkdownPublisher({
      store: recorded.store,
      origin: 'https://device.tailnet.ts.net',
      render: () => {
        renders++;
        return 'unused';
      },
    });

    try {
      publisher.publish({ markdown: '가'.repeat(699_051), target: 'funnel' });
      throw new Error('expected publish to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(MarkdownPublishError);
      expect((error as MarkdownPublishError).detail).toMatchObject({
        code: 'oversize',
        field: 'markdown',
        actualBytes: 2_097_153,
      });
    }
    expect(renders).toBe(0);
    expect(recorded.commits).toHaveLength(0);
  });

  test('propagates store failures without wrapping them', () => {
    const recorded = storeRecorder();
    const failure = new Error('injected store failure');
    recorded.store.commit = () => {
      throw failure;
    };
    const publisher = new MarkdownPublisher({
      store: recorded.store,
      origin: 'https://device.tailnet.ts.net',
      render: () => 'unused',
    });

    let caught: unknown;
    try {
      publisher.publish({ markdown: '# fail', target: 'funnel' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
  });

  test('propagates immutable store collisions without wrapping the error', () => {
    const root = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'markdown-publisher-'));
    const store = createPublishArtifactStore({ root });
    const publisher = new MarkdownPublisher({
      store,
      origin: 'https://device.tailnet.ts.net',
      randomBytes: () => Buffer.alloc(16, 5),
      render: () => '<article>ok</article>',
    });

    publisher.publish({ markdown: '# original', target: 'funnel' });
    expect(() => publisher.publish({ markdown: '# replacement', target: 'funnel' })).toThrow(
      'publish id already committed',
    );
    expect(store.readPublicArtifact(createPublishId(() => Buffer.alloc(16, 5)), 'funnel')).toBe(
      '<article>ok</article>',
    );
  });

  test('produces exactly 128-bit unpadded base64url IDs', () => {
    expect(createPublishId((size) => Buffer.alloc(size, 255) as Buffer) === ('_____________________w' as ReturnType<typeof createPublishId>)).toBe(true);
  });
});

describe('renderMarkdownDocument', () => {
  test('renders GFM in a static article with canonical Open Graph tags', () => {
    const result = renderMarkdownDocument({
      markdown: '# Weekly summary\n\nA useful first paragraph.\n\n| a | b |\n| - | - |\n| 1 | 2 |',
      canonicalUrl: 'https://device.tailnet.ts.net/d/document-id',
    });
    expect(result.html).toContain('<article>');
    expect(result.html).toContain('<table>');
    expect(result.html).toContain('property="og:url" content="https://device.tailnet.ts.net/d/document-id"');
    expect(result.html).toContain('<style>');                    // CSS 인라인 — 외부 /assets/*.css 가 S3 에 없어 404 나던 근본 해소
    expect(result.html).not.toContain('rel="stylesheet"');       // 외부 CSS 참조 없음
    expect(result.html).not.toContain('<script');                // mermaid 없으면 script 미주입
  });

  test('mermaid 코드블록 → pre.mermaid + mermaid.js CDN script (클라이언트 렌더)', () => {
    const result = renderMarkdownDocument({
      markdown: '# Chart\n\n```mermaid\ngraph TD\n  A-->B\n```',
      canonicalUrl: 'https://device.tailnet.ts.net/d/chart',
    });
    expect(result.html).toContain('<pre class="mermaid">');       // mermaid.js 가 인식하는 형태로 변환
    expect(result.html).toContain('cdn.jsdelivr.net/npm/mermaid'); // 신뢰 CDN 렌더 라이브러리
    expect(result.html).toContain('securityLevel:"strict"');      // mermaid 자체 XSS 가드
    expect(result.html).not.toContain('language-mermaid');        // 원본 code 블록은 치환돼 사라짐
  });

  test('Obsidian 콜아웃(> [!type] title) → callout 블록 클래스', () => {
    const result = renderMarkdownDocument({
      markdown: '> [!warning] 주의사항\n> 경고 본문입니다.',
      canonicalUrl: 'https://device.tailnet.ts.net/d/callout',
    });
    expect(result.html).toContain('class="callout callout-warning"');
    expect(result.html).toContain('class="callout-title">주의사항');
  });

  test('Obsidian YAML frontmatter 제거 — 메타 블록이 본문에 노출되지 않음', () => {
    const result = renderMarkdownDocument({
      markdown: '---\ntitle: 메타\ntags: [a, b]\naliases: x\n---\n\n# 본문 제목\n\n본문 내용입니다.',
      canonicalUrl: 'https://device.tailnet.ts.net/d/fm',
    });
    expect(result.html).not.toContain('tags:');
    expect(result.html).not.toContain('aliases:');
    expect(result.html).toContain('본문 제목');
    expect(result.html).toContain('본문 내용입니다');
  });

  test('removes raw HTML, dangerous URLs, and remote images while escaping metadata', () => {
    const result = renderMarkdownDocument({
      markdown: '<script>alert(1)</script><iframe src="https://evil.test"></iframe>\n\n[bad](JaVaScRiPt:alert(1)) ![tracker](https://evil.test/pixel.png)\n\n<a onclick="alert(1)" href="https://evil.test">raw</a>',
      title: '" title <tag>',
      description: '" /><script>alert(1)</script>',
      canonicalUrl: 'https://device.tailnet.ts.net/d/safe',
    });
    expect(result.html).not.toMatch(/<script|iframe|onclick|javascript:|<img/i);
    expect(result.html).not.toContain('evil.test/pixel.png');
    expect(result.html).toContain('&quot; title &lt;tag&gt;');
    expect(result.html).toContain('&lt;/script&gt;');
    expect(DEFAULT_OG_IMAGE_PNG.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});
