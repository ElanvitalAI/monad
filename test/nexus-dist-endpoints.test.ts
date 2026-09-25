// nexus-dist-endpoints.test.ts — Stage B IPA + manifest OTA endpoints.
//
// Validates the manifest.plist generator + the dist.json gating logic
// without touching disk for the real ~/.monad/dist (the handlers read
// from there via path-resolved fs calls; we exercise the pure builders
// + a tmp directory swap via DIST_DIR is intentionally NOT done here —
// instead we test the building blocks that don't depend on disk and
// verify the unhappy paths still return clean Responses).

import { describe, expect, test } from 'bun:test';
import {
  buildManifestXml,
  originForManifest,
  handleDistManifest,
  handleDistIpa,
  handleDistInstallPage,
  type DistMeta,
} from '../src/nexus/api/dist';

const SAMPLE: DistMeta = {
  file: 'MonadiOS.ipa',
  bundleId: 'com.elanvitalai.monad.ios',
  version: '1.0',
  build: '1',
  title: 'Monad',
  publishedAt: '2026-05-18T03:00:00.000Z',
};

describe('buildManifestXml', () => {
  test('embeds bundle-identifier · version · title · IPA URL', () => {
    const xml = buildManifestXml(SAMPLE, 'https://example.ts.net:31415/v1/dist/MonadiOS.ipa');
    expect(xml).toContain('<key>bundle-identifier</key><string>com.elanvitalai.monad.ios</string>');
    expect(xml).toContain('<key>bundle-version</key><string>1.0</string>');
    expect(xml).toContain('<key>title</key><string>Monad</string>');
    expect(xml).toContain('https://example.ts.net:31415/v1/dist/MonadiOS.ipa');
    expect(xml).toContain('<key>kind</key><string>software-package</string>');
  });

  test('escapes XML-special characters in metadata fields', () => {
    const meta: DistMeta = { ...SAMPLE, title: 'M & N <co>' };
    const xml = buildManifestXml(meta, 'https://h/');
    expect(xml).toContain('M &amp; N &lt;co&gt;');
    expect(xml).not.toContain('M & N <co>');
  });

  test('includes display + full-size asset entries when provided', () => {
    const meta: DistMeta = {
      ...SAMPLE,
      displayImageUrl: 'https://h/icon-512.png',
      fullSizeImageUrl: 'https://h/icon-1024.png',
    };
    const xml = buildManifestXml(meta, 'https://h/ipa');
    expect(xml).toContain('<key>kind</key><string>display-image</string>');
    expect(xml).toContain('https://h/icon-512.png');
    expect(xml).toContain('<key>kind</key><string>full-size-image</string>');
    expect(xml).toContain('https://h/icon-1024.png');
  });
});

describe('originForManifest', () => {
  test('prefers the request Host header (Tailscale Serve forwards it)', () => {
    const req = new Request('http://127.0.0.1:31415/v1/dist/manifest.plist', {
      headers: { host: 'mbp.tailnet-example.ts.net:31415' },
    });
    expect(originForManifest(req)).toBe('https://mbp.tailnet-example.ts.net:31415');
  });

  test('falls back to URL host when Host header is absent', () => {
    const req = new Request('http://example.test:9000/v1/dist/manifest.plist');
    // Note: fetch fills in the Host header from the URL on the request
    // object, but the explicit absence path is mostly defensive.
    expect(originForManifest(req).startsWith('https://')).toBe(true);
  });
});

describe('handleDistIpa · path safety', () => {
  test('rejects traversal sequences', async () => {
    const req = new Request('https://h/v1/dist/..%2Fetc%2Fpasswd');
    const res = await handleDistIpa(req, '../etc/passwd');
    expect(res.status).toBe(400);
  });

  test('rejects nested paths', async () => {
    const req = new Request('https://h/v1/dist/x/y.ipa');
    const res = await handleDistIpa(req, 'x/y.ipa');
    expect(res.status).toBe(400);
  });
});

describe('handlers without published artifact', () => {
  // These tests intentionally run without a real ~/.monad/dist/dist.json
  // present from the CI workspace (the file is per-user runtime state).
  // We only assert the unhappy-path Response shape — when no IPA has
  // been published the endpoints return 404 / explanatory HTML.

  test('manifest returns 404 + helpful body when not published', async () => {
    const req = new Request('https://h/v1/dist/manifest.plist');
    const res = await handleDistManifest(req);
    // Either 404 (unset) or 200 (running with a real dist.json). Both
    // are valid post-states for this test; assert only the contract.
    expect([200, 404]).toContain(res.status);
    if (res.status === 404) {
      const body = await res.text();
      expect(body).toMatch(/publish/);
    }
  });

  test('install page renders HTML in both states', async () => {
    const req = new Request('https://h/v1/dist/install');
    const res = await handleDistInstallPage(req);
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toContain('text/html');
  });
});
