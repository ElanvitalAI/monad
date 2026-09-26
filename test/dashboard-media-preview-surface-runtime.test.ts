import { describe, expect, test } from 'bun:test';

import {
  downloadDashboardMediaPreviewToTempFile,
  openDashboardMediaPreviewInSurface,
} from '../src/dashboard/media-preview-surface-runtime.js';

describe('downloadDashboardMediaPreviewToTempFile', () => {
  test('downloads media previews into a temp file with url-derived extension', async () => {
    const path = await downloadDashboardMediaPreviewToTempFile(
      {
        kind: 'picture',
        label: 'architecture',
        url: 'https://example.com/arch.png?size=2',
      },
      {
        tmpDir: '/tmp',
        now: () => 123,
        fetchImpl: (async () => new Response(Buffer.from('png-bytes'), { status: 200 })) as typeof fetch,
      },
    );
    expect(path).toBe('/tmp/elanous-media-preview-123.png');
  });

  test('keeps svg extension for data-url image previews', async () => {
    const path = await downloadDashboardMediaPreviewToTempFile(
      {
        kind: 'picture',
        label: 'sample',
        url: 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22%3E%3C/svg%3E',
      },
      {
        tmpDir: '/tmp',
        now: () => 456,
      },
    );
    expect(path).toBe('/tmp/elanous-media-preview-456.svg');
  });
});

describe('openDashboardMediaPreviewInSurface', () => {
  test('hydrates preview media then calls showPreviewModal seam', async () => {
    const opened: Array<{ absPath: string; title: string }> = [];
    await openDashboardMediaPreviewInSurface(
      {
        kind: 'video',
        label: 'demo',
        url: 'https://example.com/demo.mp4',
      },
      {
        downloadPreview: async () => '/tmp/demo.mp4',
        showPreviewModal: async (absPath, title) => { opened.push({ absPath, title }); },
      },
    );
    expect(opened).toEqual([{ absPath: '/tmp/demo.mp4', title: 'demo' }]);
  });
});
